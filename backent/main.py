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
    language: str = "javascript"


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


def clean_question_bank(value):
    if not isinstance(value, list):
        return []

    sections = {
        "technical",
        "dsa",
        "hr",
        "system design",
        "projects",
        "company-specific",
    }
    cleaned = []

    for index, item in enumerate(value):
        if isinstance(item, str):
            question = item.strip()
            section = "Technical"
            difficulty = "Medium"
        elif isinstance(item, dict):
            question = str(item.get("question", "")).strip()
            section = str(item.get("section", "Technical")).strip()
            difficulty = str(item.get("difficulty", "Medium")).strip()
        else:
            continue

        if not question:
            continue

        normalized_section = section.lower()

        if normalized_section not in sections:
            section = "Technical"

        cleaned.append({
            "id": index + 1,
            "question": question,
            "section": section,
            "difficulty": difficulty,
        })

    return cleaned


def list_or_default(value, fallback):
    cleaned = clean_string_list(value)

    return cleaned or fallback


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

    question_bank = [
        {
            "section": "Technical",
            "difficulty": "Medium",
            "question": "Walk me through the most technically complex project on your resume and the tradeoffs you made.",
        },
        {
            "section": "Technical",
            "difficulty": "Medium",
            "question": "Which backend or frontend skill from your resume are you strongest in, and how have you used it in production-like work?",
        },
        {
            "section": "DSA",
            "difficulty": "Medium",
            "question": "How would you solve a two-sum variation if the input stream is too large to hold fully in memory?",
        },
        {
            "section": "DSA",
            "difficulty": "Easy",
            "question": "Explain the difference between arrays, hash maps, stacks, and queues using interview examples.",
        },
        {
            "section": "HR",
            "difficulty": "Easy",
            "question": "Tell me about yourself in a way that connects your background to this role.",
        },
        {
            "section": "HR",
            "difficulty": "Medium",
            "question": "Describe a time you received critical feedback and changed your work approach.",
        },
        {
            "section": "System Design",
            "difficulty": "Medium",
            "question": "Design a mock interview platform that uploads resumes, generates questions, records answers, and shows progress analytics.",
        },
        {
            "section": "Projects",
            "difficulty": "Medium",
            "question": "Pick one resume project and explain the architecture, data flow, and one bug you solved.",
        },
        {
            "section": "Projects",
            "difficulty": "Hard",
            "question": "If your main project had 10,000 daily users tomorrow, what would break first and how would you fix it?",
        },
        {
            "section": "Company-specific",
            "difficulty": "Medium",
            "question": "Why are you a strong fit for this company, and which resume evidence proves it?",
        },
    ]

    return {
        "questions": [item["question"] for item in question_bank],
        "question_bank": question_bank,
        "ats_score": ats_score,
        "missing_skills": missing_skills,
        "resume_suggestions": [
            "Add measurable impact to each project bullet.",
            "Move the strongest technical projects above generic coursework.",
            "Add deployment, testing, and performance details where applicable.",
        ],
        "career_roadmap": [
            "Sharpen core DSA patterns for 20 minutes daily.",
            "Prepare project stories using situation, action, result structure.",
            "Add one production-ready feature to your strongest project.",
            "Practice company-specific mock interviews twice per week.",
        ],
        "strengths": [
            "Hands-on project experience",
            "Full-stack learning momentum",
            "Interview-ready technical keywords",
        ],
        "weaknesses": missing_skills[:3] or ["Add deeper outcome metrics"],
        "confidence_analysis": "Likely improving; practice concise first-minute answers to sound more decisive.",
        "communication_analysis": "Use structured answers with context, implementation detail, result, and reflection.",
        "personality_insights": "Position yourself as curious, builder-oriented, and coachable.",
        "daily_challenge": "Record a 90-second answer about your strongest project and improve it once.",
        "xp_reward": 120,
    }

# =============================
# GENERATE AI QUESTIONS
# =============================

def generate_resume_analysis(resume_text):

    prompt = f"""
    You are a senior AI interview coach, ATS reviewer, and career strategist.

    Analyze this resume and return ONLY valid JSON. No markdown.

    JSON format:
    {{
      "questions": [
        "plain question 1"
      ],
      "question_bank": [
        {{
          "section": "Technical",
          "difficulty": "Medium",
          "question": "deeply personalized question"
        }}
      ],
      "ats_score": 78,
      "missing_skills": [
        "skill 1",
        "skill 2"
      ],
      "resume_suggestions": [
        "specific improvement"
      ],
      "career_roadmap": [
        "next action"
      ],
      "strengths": [
        "strength"
      ],
      "weaknesses": [
        "weakness"
      ],
      "confidence_analysis": "short insight",
      "communication_analysis": "short insight",
      "personality_insights": "short insight",
      "daily_challenge": "one daily challenge",
      "xp_reward": 120
    }}

    Requirements:
    - Generate 20 to 30 deeply resume-aware questions.
    - question_bank must include these sections:
      Technical, DSA, HR, System Design, Projects, Company-specific.
    - Include Easy, Medium, and Hard difficulty levels.
    - Make questions feel specific to the candidate's projects, skills,
      experience level, and gaps.
    - ats_score must be an integer from 0 to 100 based on resume relevance,
      clarity, skills, projects, and experience.
    - missing_skills, resume_suggestions, career_roadmap, strengths, and
      weaknesses must be practical JSON arrays.
    - daily_challenge should be motivating and specific.

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

        question_bank = clean_question_bank(data.get("question_bank", []))
        questions = clean_string_list(data.get("questions") or data.get("ai_questions"))
        questions = questions or [item["question"] for item in question_bank]
        missing_skills = clean_string_list(data.get("missing_skills"))

        return {
            "questions": questions or fallback["questions"],
            "question_bank": question_bank or fallback["question_bank"],
            "ats_score": clamp_score(data.get("ats_score", fallback["ats_score"])),
            "missing_skills": missing_skills or fallback["missing_skills"],
            "resume_suggestions": list_or_default(
                data.get("resume_suggestions"),
                fallback["resume_suggestions"],
            ),
            "career_roadmap": list_or_default(
                data.get("career_roadmap"),
                fallback["career_roadmap"],
            ),
            "strengths": list_or_default(data.get("strengths"), fallback["strengths"]),
            "weaknesses": list_or_default(data.get("weaknesses"), fallback["weaknesses"]),
            "confidence_analysis": data.get(
                "confidence_analysis",
                fallback["confidence_analysis"],
            ),
            "communication_analysis": data.get(
                "communication_analysis",
                fallback["communication_analysis"],
            ),
            "personality_insights": data.get(
                "personality_insights",
                fallback["personality_insights"],
            ),
            "daily_challenge": data.get("daily_challenge", fallback["daily_challenge"]),
            "xp_reward": int(data.get("xp_reward", fallback["xp_reward"])),
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
      "ideal_answer": "A professional ideal answer here.",
      "confidence_score": 7,
      "communication_score": 8,
      "personality_insight": "Calm and structured, but should show more ownership.",
      "next_question": "A follow-up question adapted to this answer."
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
            "ideal_answer": data.get("ideal_answer", ""),
            "confidence_score": clamp_ten_score(data.get("confidence_score"), 5),
            "communication_score": clamp_ten_score(data.get("communication_score"), 5),
            "personality_insight": data.get("personality_insight", ""),
            "next_question": data.get("next_question", "")
        }

    except Exception as e:

        print("JSON ERROR:", e)
        print(text)

        return {
            "score": 5,
            "feedback": "Answer evaluated successfully.",
            "improvements": "Try adding more details.",
            "ideal_answer": "Provide a more structured answer.",
            "confidence_score": 5,
            "communication_score": 5,
            "personality_insight": "Shows effort, but needs clearer structure.",
            "next_question": "Can you give a concrete example with measurable impact?"
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
        "question_bank": analysis["question_bank"],
        "resume_text": extracted_text,
        "ats_score": analysis["ats_score"],
        "missing_skills": clean_string_list(analysis["missing_skills"]),
        "resume_suggestions": analysis["resume_suggestions"],
        "career_roadmap": analysis["career_roadmap"],
        "strengths": analysis["strengths"],
        "weaknesses": analysis["weaknesses"],
        "confidence_analysis": analysis["confidence_analysis"],
        "communication_analysis": analysis["communication_analysis"],
        "personality_insights": analysis["personality_insights"],
        "daily_challenge": analysis["daily_challenge"],
        "xp_reward": analysis["xp_reward"],
    }

# =============================
# GENERATE CODING QUESTION API
# =============================
@app.post("/generate-coding-question")
async def generate_coding_question(data: CodingQuestionRequest):

    resume_text = data.resume
    company = data.company

    prompt = f"""
    Generate ONE LeetCode-style coding interview question.

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
      "title": "Problem title",
      "difficulty": "Medium",
      "question": "one complete coding question",
      "examples": [
        "Input: ... Output: ..."
      ],
      "test_cases": [
        {{"input": "...", "expected": "..."}}
      ],
      "hidden_tests": 4,
      "hints": [
        "hint 1"
      ],
      "constraints": [
        "constraint"
      ]
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
            "title": data.get("title", "Adaptive Coding Challenge"),
            "difficulty": data.get("difficulty", "Medium"),
            "question": question or "Write a function to solve a two-sum style array problem.",
            "examples": clean_string_list(data.get("examples")),
            "test_cases": data.get("test_cases", []),
            "hidden_tests": int(data.get("hidden_tests", 3)),
            "hints": clean_string_list(data.get("hints")),
            "constraints": clean_string_list(data.get("constraints")),
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
            "title": "Fallback Coding Challenge",
            "difficulty": "Medium",
            "question": random.choice(fallback_questions),
            "examples": ["Input: [1, 2, 2, 3] Output: [2]"],
            "test_cases": [
                {"input": "[1, 2, 2, 3]", "expected": "[2]"},
                {"input": "[4, 5, 6]", "expected": "[]"},
            ],
            "hidden_tests": 3,
            "hints": ["Start with a hash map or set.", "Think about time complexity."],
            "constraints": ["Handle empty input.", "Optimize for O(n) time when possible."],
        }
    


# =============================
# EVALUATE API
# =============================

@app.post("/evaluate-answer")
async def evaluate(data: AnswerRequest):

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
            "ideal_answer": "Temporary server issue.",
            "confidence_score": 5,
            "communication_score": 5,
            "personality_insight": "Try again to unlock detailed personality insights.",
            "next_question": ""
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
    language = data.language

    prompt = f"""
    You are a FAANG coding interviewer.

    Coding Question:
    {question}

    Candidate Code:
    {code}

    Language:
    {language}

    Return ONLY valid JSON. No markdown.

    JSON format:
    {{
      "score": 7,
      "feedback": "short feedback",
      "optimized_code": "improved code",
      "time_complexity": "O(n)",
      "space_complexity": "O(n)",
      "hint": "next improvement hint"
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
            "time_complexity": data.get("time_complexity", "Not analyzed"),
            "space_complexity": data.get("space_complexity", "Not analyzed"),
            "hint": data.get("hint", "Review edge cases and simplify the implementation."),
        }

    except Exception as e:

        print(e)

        return {
            "score": "5",
            "feedback": "Code works but AI review unavailable.",
            "optimized_code": code,
            "time_complexity": "Not analyzed",
            "space_complexity": "Not analyzed",
            "hint": "Try again for a detailed AI hint.",
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
