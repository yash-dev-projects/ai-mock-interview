import { useState } from "react";
import axios from "axios";

function App() {

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState([]);

  const [currentQuestion, setCurrentQuestion] = useState("");

  // -------------------------
  // Load voices
  // -------------------------
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };

  // -------------------------
  // Clean markdown
  // -------------------------
  const cleanTextForSpeech = (text) => {
    return text
      .replace(/#{1,6}\s?/g, "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/---/g, "")
      .replace(/`/g, "")
      .replace(/[>|•]/g, "")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  // -------------------------
  // Speak Question
  // -------------------------
  const speakQuestion = (text) => {

    const cleanedText = cleanTextForSpeech(text);

    const speech = new SpeechSynthesisUtterance(cleanedText);

    speech.lang = "en-US";
    speech.rate = 0.9;
    speech.pitch = 1;
    speech.volume = 1;

    const voices = window.speechSynthesis.getVoices();

    const preferredVoice =
      voices.find((voice) =>
        voice.name.includes("Google US English")
      ) ||
      voices.find((voice) =>
        voice.name.includes("Microsoft David")
      ) ||
      voices[0];

    if (preferredVoice) {
      speech.voice = preferredVoice;
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(speech);

    setCurrentQuestion(cleanedText);
  };

  // -------------------------
  // Voice Answer
  // -------------------------
  // Voice answer
const startListening = () => {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    alert("Speech Recognition not supported");
    return;
  }

  const recognition = new SpeechRecognition();

  recognition.lang = "en-US";
  recognition.interimResults = false;

  recognition.start();

  recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;

    try {

      const response = await axios.post(
        "http://127.0.0.1:8000/evaluate-answer",
        {
          question: currentQuestion,
          answer: transcript,
        }
      );

      setAnswers((prev) => [
        ...prev,
        {
          question: currentQuestion,
          answer: transcript,
          score: response.data.score,
          feedback: response.data.feedback,
          improvements: response.data.improvements,
          ideal_answer: response.data.ideal_answer,
        },
      ]);

    } catch (error) {
      console.log(error);
      alert("Evaluation Failed");
    }
  };
};

  // -------------------------
  // Upload Resume
  // -------------------------
  const handleUpload = async () => {

    if (!file) {
      alert("Please select resume");
      return;
    }

    const formData = new FormData();

    formData.append("file", file);

    try {

      setLoading(true);

      const response = await axios.post(
        "http://127.0.0.1:8000/upload-resume",
        formData
      );

      const generated =
        response.data.ai_questions;

      const splitQuestions = generated
        .split("\n")
        .filter(
          (q) =>
            q.trim().length > 15 &&
            !q.includes("Technical Interview Questions") &&
            !q.includes("HR Interview Questions") &&
            !q.includes("Project-Based Questions") &&
            !q.includes("---") &&
            !q.includes("Good luck")
        );

      setQuestions(splitQuestions);

    } catch (error) {

      console.log(error);

      alert("Upload Failed");

    } finally {

      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">

      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <h1 className="text-5xl font-bold text-center mb-3">
          AI Mock Interview
        </h1>

        <p className="text-center text-gray-400 mb-10">
          Upload Resume → AI Questions → Voice Answers → AI Feedback
        </p>

        {/* Upload */}
        <div className="bg-slate-900 p-8 rounded-2xl border border-slate-700 shadow-2xl">

          <input
            type="file"
            accept=".pdf"
            onChange={(e) =>
              setFile(e.target.files[0])
            }
            className="mb-6 block w-full text-sm text-gray-300
            file:mr-4 file:py-3 file:px-6
            file:rounded-xl file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-600 file:text-white
            hover:file:bg-blue-700"
          />

          <button
            onClick={handleUpload}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 transition-all duration-300 py-3 rounded-xl text-lg font-semibold"
          >
            {loading
              ? "Generating Questions..."
              : "Generate Interview Questions"}
          </button>

        </div>

        {/* Questions */}
        {questions.length > 0 && (

          <div className="mt-10 bg-slate-900 border border-slate-700 rounded-2xl p-8 shadow-2xl">

            <h2 className="text-3xl font-bold mb-6 text-blue-400">
              AI Interview Questions
            </h2>

            <div className="space-y-6">

              {questions.map((q, index) => (

                <div
                  key={index}
                  className="bg-slate-800 p-5 rounded-xl border border-slate-700"
                >

                  <p className="text-gray-200 mb-4">
                    {q}
                  </p>

                  <div className="flex gap-4">

                    <button
                      onClick={() => speakQuestion(q)}
                      className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg"
                    >
                      Speak
                    </button>

                    <button
                      onClick={startListening}
                      className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg"
                    >
                      Answer
                    </button>

                  </div>

                </div>
              ))}

            </div>

          </div>
        )}

        {/* Answers */}
        {answers.length > 0 && (

          <div className="mt-10 bg-slate-900 border border-slate-700 rounded-2xl p-8">

            <h2 className="text-3xl font-bold mb-6 text-green-400">
              AI Feedback Report
            </h2>

            <div className="space-y-8">

              {answers.map((item, index) => (

                <div
                  key={index}
                  className="bg-slate-800 p-6 rounded-xl border border-slate-700"
                >

                  {/* Question */}
                  <h3 className="text-xl font-bold text-blue-400 mb-2">
                    Question
                  </h3>

                  <p className="text-gray-300 mb-5">
                    {item.question}
                  </p>

                  {/* Answer */}
                  <h3 className="text-xl font-bold text-green-400 mb-2">
                    Your Answer
                  </h3>

                  <p className="text-gray-300 mb-5">
                    {item.answer}
                  </p>

                  {/* Score */}
                  <div className="mb-5">

                    <h3 className="text-xl font-bold text-yellow-400 mb-2">
                      Interview Score
                    </h3>

                    <div className="w-full bg-slate-700 rounded-full h-5">

                      <div
                        className="bg-yellow-400 h-5 rounded-full"
                        style={{
                          width: `${item.score * 10}%`,
                        }}
                      ></div>

                    </div>

                    <p className="mt-2 text-yellow-300">
                      {item.score}/10
                    </p>

                  </div>

                  {/* Feedback */}
                  <h3 className="text-xl font-bold text-purple-400 mb-2">
                    AI Feedback
                  </h3>

                  <p className="text-gray-300 mb-5">
                    {item.feedback}
                  </p>

                  {/* Improvements */}
                  <h3 className="text-xl font-bold text-red-400 mb-2">
                    Improvements
                  </h3>

                  <p className="text-gray-300 mb-5">
                    {item.improvements}
                  </p>

                  {/* Ideal Answer */}
                  <h3 className="text-xl font-bold text-cyan-400 mb-2">
                    Ideal Answer
                  </h3>

                  <p className="text-gray-300">
                    {item.ideal_answer}
                  </p>

                </div>
              ))}

            </div>

          </div>
        )}

      </div>

    </div>
  );
}

export default App;