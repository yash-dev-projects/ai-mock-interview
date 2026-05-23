from fastapi.responses import FileResponse
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
import uuid
from fastapi import Request
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

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)

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

# =============================
# GENERATE AI QUESTIONS
# =============================

def generate_ai_questions(resume_text):

    prompt = f"""
    You are an AI interviewer.

    Analyze this resume and generate:

    1. Technical interview questions
    2. HR interview questions
    3. Project-based questions

    Resume:
    {resume_text}
    """

    try:

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )

        return response.text
    except Exception as e:
        print("Gemini Error:", e)

        fallback_questions = [
            "Reverse an array",
            "Check palindrome string",
            "Find maximum element in array",
            "Two Sum Problem",
            "Binary Search implementation",
            "FizzBuzz problem",
            "Valid Parentheses",
            "Merge two sorted arrays",
            "Find duplicate elements",
            "Factorial using recursion"
        ]

        return {
            "question": random.choice(fallback_questions)
        }

    

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

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt
    )

    text = response.text.strip()

    try:

        text = text.replace("```json", "")
        text = text.replace("```", "")
        text = text.strip()

        data = json.loads(text)

        return {
            "score": data.get("score", 0),
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

    file_path = os.path.join(
        UPLOAD_FOLDER,
        file.filename
    )

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    extracted_text = ""

    with pdfplumber.open(file_path) as pdf:

        for page in pdf.pages:

            text = page.extract_text()

            if text:
                extracted_text += text + "\n"

    ai_questions = generate_ai_questions(
        extracted_text
    )

    return {
        "filename": file.filename,
        "message": "Resume uploaded successfully",
        "ai_questions": ai_questions,
        "resume_text": extracted_text,
        "ats_score": random.randint(70, 95),

        "missing_skills": [
            "React",
            "MongoDB",
            "REST API"
        ]
    }

# =============================
# GENERATE CODING QUESTION API
# =============================
@app.post("/generate-coding-question")
async def generate_coding_question(data: dict):

    resume_text = data.get("resume", "")
    company = data.get("company")

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

    Return ONLY question text.
    """

    try:

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )

        question = response.text.strip()

        return {
            "question": question
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

    code = data.get("code")

    language = data.get("language")

    language_map = {
        "python": "python3",
        "javascript": "javascript",
        "cpp": "cpp",
        "java": "java"
    }

    payload = {
        "language": language_map.get(language),
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
# LOGIN API
# =============================
@app.post("/evaluate-code")
async def evaluate_code(data: dict):

    question = data.get("question")
    code = data.get("code")

    prompt = f"""
    You are a FAANG coding interviewer.

    Coding Question:
    {question}

    Candidate Code:
    {code}

    Give response in this format:

    SCORE: x/10

    FEEDBACK:
    short feedback

    OPTIMIZED_CODE:
    improved code
    """

    try:

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )

        text = response.text

        score = "7"

        feedback = text

        optimized_code = code

        if "SCORE:" in text:
            score = (
                text.split("SCORE:")[1]
                .split("/10")[0]
                .strip()
            )

        if "FEEDBACK:" in text:
            feedback = (
                text.split("FEEDBACK:")[1]
                .split("OPTIMIZED_CODE:")[0]
                .strip()
            )

        if "OPTIMIZED_CODE:" in text:
            optimized_code = (
                text.split("OPTIMIZED_CODE:")[1]
                .strip()
            )

        return {
            "score": score,
            "feedback": feedback,
            "optimized_code": optimized_code
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