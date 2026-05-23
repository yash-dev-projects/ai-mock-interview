from fastapi.responses import FileResponse
from reportlab.lib.styles import getSampleStyleSheet
from fastapi import HTTPException, Request
import requests
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import shutil
import os
import pdfplumber
import json
import random
import ast
import re

import google.generativeai as genai

from database import SessionLocal, engine
from models import User, Interview
from auth import (
    hash_password,
    verify_password,
    create_access_token
)


from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer
)

# =============================
# CREATE TABLES
# =============================

User.metadata.create_all(bind=engine)
Interview.metadata.create_all(bind=engine)

# =============================
# FASTAPI APP
# =============================

app = FastAPI()

# =============================
# CORS
# =============================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =============================
# GEMINI API
# =============================

genai.configure(
    api_key=os.getenv("GEMINI_API_KEY")
)

model = genai.GenerativeModel("gemini-1.5-flash")
# =============================
# UPLOAD FOLDER
# =============================

UPLOAD_FOLDER = "uploads"

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# =============================
# REQUEST MODELS
# =============================

class SignupRequest(BaseModel):
    name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class AnswerRequest(BaseModel):
    question: str
    answer: str
    email: str


class CodingQuestionRequest(BaseModel):
    resume: str = ""
    company: str = "Google"


class CodeEvaluationRequest(BaseModel):
    question: str
    code: str


def strip_code_fences(text):
    text = (text or "").strip()
    text = re.sub(r"^```(?:json|python)?", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"```$", "", text).strip()
    return text


def extract_json_text(text):
    text = strip_code_fences(text)
    start_positions = [pos for pos in [text.find("{"), text.find("[")] if pos != -1]

    if not start_positions:
        return text

    start = min(start_positions)
    end = max(text.rfind("}"), text.rfind("]"))

    if end > start:
        return text[start:end + 1]

    return text


def parse_json_object(text, fallback):
    cleaned = extract_json_text(text)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        try:
            return ast.literal_eval(cleaned)
        except (ValueError, SyntaxError):
            return fallback


def clean_string_list(value):
    if isinstance(value, str):
        value = value.splitlines()

    if not isinstance(value, list):
        return []

    cleaned = []

    for item in value:
        if isinstance(item, dict):
            item = item.get("question") or item.get("skill") or json.dumps(item)

        item = str(item).strip()
        item = re.sub(r"^\s*(?:[-*]|\d+[.)])\s*", "", item).strip()

        if item and item not in cleaned:
            cleaned.append(item)

    return cleaned


def clamp_score(value):
    try:
        score = int(float(value))
    except (TypeError, ValueError):
        score = 0

    return max(0, min(100, score))


def clamp_ten_score(value, default=0):
    match = re.search(r"\d+(?:\.\d+)?", str(value))

    if not match:
        return default

    return max(0, min(10, int(float(match.group()))))


def fallback_resume_analysis(resume_text):
    target_skills = [
        "Python",
        "JavaScript",
        "React",
        "FastAPI",
        "SQL",
        "REST API",
        "Git",
        "Data Structures",
    ]
    resume_lower = resume_text.lower()
    found_count = sum(1 for skill in target_skills if skill.lower() in resume_lower)
    missing_skills = [
        skill for skill in target_skills
        if skill.lower() not in resume_lower
    ][:5]
    ats_score = clamp_score(45 + found_count * 7 + min(len(resume_text) // 250, 15))

    return {
        "questions": [
            "Tell me about yourself and the strongest project on your resume.",
            "Which technical skill from your resume are you most confident using?",
            "Explain one project architecture decision you made and why.",
            "Describe a difficult bug you fixed and how you found the root cause.",
            "How do you prioritize tasks when deadlines are close?",
            "What would you improve in your latest project if you had more time?",
        ],
        "ats_score": ats_score,
        "missing_skills": missing_skills,
    }

# =============================
# GENERATE AI QUESTIONS
# =============================

def generate_resume_analysis(resume_text):

    prompt = f"""
    You are an AI interviewer and ATS resume reviewer.

    Analyze this resume and return ONLY valid JSON. No markdown.

    JSON format:
    {{
      "questions": [
        "question 1",
        "question 2"
      ],
      "ats_score": 78,
      "missing_skills": [
        "skill 1",
        "skill 2"
      ]
    }}

    Requirements:
    - questions must be a JSON array of 8 to 10 plain strings.
    - include technical, HR, and project-based questions.
    - ats_score must be an integer from 0 to 100 based on resume relevance,
      clarity, skills, projects, and experience.
    - missing_skills must be a JSON array of skills that would improve this
      resume for software engineering interviews.

    Resume:
    {resume_text}
    """
    fallback = fallback_resume_analysis(resume_text)

    try:
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"},
        )
        data = parse_json_object(response.text, fallback)

        if isinstance(data, list):
            data = {"questions": data}

        questions = clean_string_list(data.get("questions") or data.get("ai_questions"))
        missing_skills = clean_string_list(data.get("missing_skills"))

        return {
            "questions": questions or fallback["questions"],
            "ats_score": clamp_score(data.get("ats_score", fallback["ats_score"])),
            "missing_skills": missing_skills or fallback["missing_skills"],
        }

    except Exception as e:
        print("Gemini Error:", e)
        return fallback


def generate_ai_questions(resume_text):
    return generate_resume_analysis(resume_text)["questions"]

    

# =============================
# EVALUATE ANSWER
# =============================

def evaluate_answer(question, answer):

    prompt = f"""
    You are an expert AI interviewer.

    Evaluate this candidate answer professionally.

    QUESTION:
    {question}

    ANSWER:
    {answer}

    IMPORTANT:
    Return ONLY valid JSON.
    Do not add markdown.
    Do not add explanation.
    Keep ideal_answer short and crisp.
    Maximum 5 to 6 lines only.

    JSON FORMAT:

    {{
      "score": 8,
      "feedback": "Good communication and confidence.",
      "improvements": "Add more technical depth.",
      "ideal_answer": "A professional ideal answer here."
    }}
    """

    response = model.generate_content(
        prompt,
        generation_config={"response_mime_type": "application/json"},
    )

    text = response.text.strip()

    try:

        data = parse_json_object(text, {})

        return {
            "score": clamp_ten_score(data.get("score"), 0),
            "feedback": data.get("feedback", ""),
            "improvements": data.get("improvements", ""),
            "ideal_answer": data.get("ideal_answer", "")
        }

    except Exception as e:

        print("JSON ERROR:", e)
        print(text)

        return {
            "score": 5,
            "feedback": "Answer evaluated successfully.",
            "improvements": "Try adding more details.",
            "ideal_answer": "Provide a more structured answer."
        }

# =============================
# UPLOAD RESUME API
# =============================

@app.post("/upload-resume")
async def upload_resume(file: UploadFile = File(...)):

    safe_filename = os.path.basename(file.filename)
    file_path = os.path.join(UPLOAD_FOLDER, safe_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    extracted_text = ""

    try:
        with pdfplumber.open(file_path) as pdf:

            for page in pdf.pages:

                text = page.extract_text()

                if text:
                    extracted_text += text + "\n"
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read PDF resume: {e}",
        )

    analysis = generate_resume_analysis(extracted_text)

    return {
        "filename": safe_filename,
        "message": "Resume uploaded successfully",
        "ai_questions": clean_string_list(analysis["questions"]),
        "resume_text": extracted_text,
        "ats_score": analysis["ats_score"],
        "missing_skills": clean_string_list(analysis["missing_skills"]),
    }

# =============================
# GENERATE CODING QUESTION API
# =============================
@app.post("/generate-coding-question")
async def generate_coding_question(data: CodingQuestionRequest):

    resume_text = data.resume
    company = data.company

    prompt = f"""
    Generate ONE coding interview question.

    Company:
    {company}

    Candidate Skills:
    {resume_text}

    Rules:

    If company is Google/Amazon/Microsoft:
    - Ask medium DSA

    If company is TCS/Infosys:
    - Ask beginner DSA

    If company is Startup:
    - Ask practical React/JavaScript/Python tasks

    Focus on:
    Arrays
    Strings
    HashMaps
    Recursion
    Stack
    Queue

    Return ONLY valid JSON. No markdown.

    JSON format:
    {{
      "question": "one complete coding question"
    }}
    """

    try:

        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"},
        )

        data = parse_json_object(response.text, {})
        question = data.get("question") if isinstance(data, dict) else response.text
        question = strip_code_fences(str(question)).strip()

        return {
            "question": question or "Write a function to solve a two-sum style array problem."
        }

    except Exception as e:

        print("Gemini Error:", e)

        # FALLBACK QUESTIONS
        fallback_questions = [

            "Write a Python function to find duplicate elements in a list.",

            "Create a JavaScript function to check if a string is palindrome.",

            "Write a Python program to count word frequency in a sentence.",

            "Create a JavaScript function to remove duplicates from an array.",

            "Write a Python function to sort dictionary by values."
        ]

        import random

        return {
            "question": random.choice(fallback_questions)
        }
    


# =============================
# EVALUATE API
# =============================

@app.post("/evaluate-answer")
async def evaluate(data: AnswerRequest):

    print(data)

    try:

        result = evaluate_answer(
            data.question,
            data.answer
        )

    except Exception as e:

        print("Evaluation Error:", e)

        result = {
            "score": 5,
            "feedback": "AI server busy right now.",
            "improvements": "Please try again later.",
            "ideal_answer": "Temporary server issue."
        }

    db = SessionLocal()

    new_interview = Interview(
        user_email=data.email,
        question=data.question,
        answer=data.answer,
        score=result["score"],
        feedback=result["feedback"],
        improvements=result["improvements"],
        ideal_answer=result["ideal_answer"]
    )

    db.add(new_interview)

    db.commit()

    db.close()

    return result
@app.post("/run-code")
async def run_code(request: Request):

    data = await request.json()

    code = data.get("code", "")

    language = data.get("language")

    language_map = {
        "python": "python3",
        "javascript": "javascript",
        "cpp": "cpp",
        "java": "java"
    }

    piston_language = language_map.get(language)

    if not piston_language:
        raise HTTPException(status_code=400, detail="Unsupported language")

    payload = {
        "language": piston_language,
        "version": "*",
        "files": [
            {
                "content": code
            }
        ]
    }

    try:

        response = requests.post(
            "https://emkc.org/api/v2/piston/execute",
            json=payload
        )

        result = response.json()

        return {
            "output":
            result.get("run", {}).get("output", "")
        }

    except Exception as e:

        return {
            "output": str(e)
        }

# =============================
# EVALUATE CODE API
# =============================
@app.post("/evaluate-code")
async def evaluate_code(data: CodeEvaluationRequest):

    question = data.question
    code = data.code

    prompt = f"""
    You are a FAANG coding interviewer.

    Coding Question:
    {question}

    Candidate Code:
    {code}

    Return ONLY valid JSON. No markdown.

    JSON format:
    {{
      "score": 7,
      "feedback": "short feedback",
      "optimized_code": "improved code"
    }}
    """

    try:

        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"},
        )

        data = parse_json_object(response.text, {})

        return {
            "score": clamp_ten_score(data.get("score"), 7),
            "feedback": data.get("feedback", "Code reviewed successfully."),
            "optimized_code": data.get("optimized_code", code),
        }

    except Exception as e:

        print(e)

        return {
            "score": "5",
            "feedback": "Code works but AI review unavailable.",
            "optimized_code": code
        }

@app.post("/login")
async def login(data: LoginRequest):

    db = SessionLocal()

    user = db.query(User).filter(
        User.email == data.email
    ).first()

    if not user:

        return {
            "message": "Invalid email"
        }

    valid_password = verify_password(
        data.password,
        user.password
    )

    if not valid_password:

        return {
            "message": "Invalid password"
        }

    token = create_access_token(
        data={
            "email": user.email
        }
    )

    db.close()

    return {
        "token": token,
        "name": user.name,
        "email": user.email
    }


@app.post("/signup")
async def signup(data: SignupRequest):

    db = SessionLocal()

    existing_user = db.query(User).filter(
        User.email == data.email
    ).first()

    if existing_user:
        db.close()
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        name=data.name,
        email=data.email,
        password=hash_password(data.password)
    )

    db.add(user)
    db.commit()
    db.close()

    return {
        "message": "Signup successful"
    }
@app.get("/history/{email}")
async def get_history(email: str):

    db = SessionLocal()

    interviews = db.query(Interview).filter(
        Interview.user_email == email
    ).all()

    results = []

    for item in interviews:

        results.append({
            "question": item.question,
            "answer": item.answer,
            "score": item.score,
            "feedback": item.feedback,
            "improvements": item.improvements,
            "ideal_answer": item.ideal_answer
        })

    db.close()

    return results
# =============================
# DOWNLOAD PDF REPORT
# =============================

@app.get("/download-report/{email}")

async def download_report(email: str):

    db = SessionLocal()

    interviews = db.query(Interview).filter(
        Interview.user_email == email
    ).all()

    pdf_file = f"{email}_report.pdf"

    doc = SimpleDocTemplate(pdf_file)

    styles = getSampleStyleSheet()

    elements = []

    title = Paragraph(
        "AI Mock Interview Report",
        styles["Title"]
    )

    elements.append(title)

    elements.append(Spacer(1, 20))

    for item in interviews:

        elements.append(
            Paragraph(
                f"<b>Question:</b> {item.question}",
                styles["BodyText"]
            )
        )

        elements.append(
            Paragraph(
                f"<b>Answer:</b> {item.answer}",
                styles["BodyText"]
            )
        )

        elements.append(
            Paragraph(
                f"<b>Score:</b> {item.score}/10",
                styles["BodyText"]
            )
        )

        elements.append(
            Paragraph(
                f"<b>Feedback:</b> {item.feedback}",
                styles["BodyText"]
            )
        )

        elements.append(
            Paragraph(
                f"<b>Improvements:</b> {item.improvements}",
                styles["BodyText"]
            )
        )

        elements.append(
            Paragraph(
                f"<b>Ideal Answer:</b> {item.ideal_answer}",
                styles["BodyText"]
            )
        )

        elements.append(Spacer(1, 25))

    doc.build(elements)

    db.close()

    return FileResponse(
        pdf_file,
        media_type="application/pdf",
        filename=pdf_file
    )
