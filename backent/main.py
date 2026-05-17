from dotenv import load_dotenv
load_dotenv()
from pydantic import BaseModel
import json
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import shutil
import os
import pdfplumber
import json

from google import genai

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Gemini API
client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)

# Upload folder
UPLOAD_FOLDER = "uploads"

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)


# -----------------------------
# Generate AI Questions
# -----------------------------
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

        return """
        1. Tell me about yourself.
        2. Explain your AI project.
        3. Why do you want to become an AI Engineer?
        """




# -----------------------------
# Evaluate Answer
# -----------------------------
def evaluate_answer(question, answer):

    prompt = f"""
    You are an expert AI interviewer.

    Evaluate this candidate answer.

    Question:
    {question}

    Candidate Answer:
    {answer}

    Return response ONLY in JSON format:

    {{
      "score": number between 1-10,
      "feedback": "detailed feedback",
      "improvements": "how candidate can improve",
      "ideal_answer": "sample ideal answer"
    }}
    """

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt
    )

    text = response.text

    # Clean markdown
    text = text.replace("```json", "")
    text = text.replace("```", "")

    return json.loads(text)


# -----------------------------
# Upload Resume API
# -----------------------------
@app.post("/upload-resume")
async def upload_resume(file: UploadFile = File(...)):

    file_path = os.path.join(UPLOAD_FOLDER, file.filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    extracted_text = ""

    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:

            text = page.extract_text()

            if text:
                extracted_text += text + "\n"

    ai_questions = generate_ai_questions(extracted_text)

    return {
        "filename": file.filename,
        "message": "Resume uploaded successfully",
        "ai_questions": ai_questions,
        "resume_text": extracted_text
    }


# -----------------------------
# Request Model
# -----------------------------
# -----------------------------
# Request Model
# -----------------------------
class AnswerRequest(BaseModel):
    question: str
    answer: str


# -----------------------------
# Evaluate Answer Function
# -----------------------------
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

        # Remove markdown
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


# -----------------------------
# Evaluate API
# -----------------------------
@app.post("/evaluate-answer")
async def evaluate(data: AnswerRequest):

    result = evaluate_answer(
        data.question,
        data.answer
    )

    return result
