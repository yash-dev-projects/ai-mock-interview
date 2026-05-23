import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import "./App.css";
import Editor from "@monaco-editor/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://ai-mock-interview-ji82.onrender.com";

const apiUrl = (path) => `${API_BASE_URL}${path}`;

const normalizeStringArray = (value) => {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
    ? value.split("\n")
    : [];

  return list
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object") {
        return item.question || item.skill || JSON.stringify(item);
      }

      return "";
    })
    .map((item) => item.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter((item, index, array) => item && array.indexOf(item) === index);
};

const toScore = (value) => {
  const score = Number(value);

  return Number.isFinite(score) ? score : 0;
};

function App() {

  // =========================
  // AUTH STATES
  // =========================
  const [isLogin, setIsLogin] = useState(true);

  const [name, setName] = useState("");

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [message, setMessage] = useState("");

  const [isAuthenticated, setIsAuthenticated] = useState(
    localStorage.getItem("token") ? true : false
  );

  // =========================
  // INTERVIEW STATES
  // =========================
  const [file, setFile] = useState(null);

  const [loading, setLoading] = useState(false);

  const [questions, setQuestions] = useState([]);

  const [answers, setAnswers] = useState([]);

  const [bestScore, setBestScore] =
    useState(0);

  const [totalInterviews, setTotalInterviews] =
    useState(0);

  const [currentQuestion, setCurrentQuestion] = useState("");
  const [avatarSpeaking, setAvatarSpeaking] =
    useState(false);

  // =========================
  // NEW FEATURE STATES
  // =========================
  const [averageScore, setAverageScore] = useState(0);
  const [atsScore, setAtsScore] = useState(0);

  const [missingSkills, setMissingSkills] =
    useState([]);

  const [selectedCategory, setSelectedCategory] =
    useState("All");
  const [companyMode, setCompanyMode] =
    useState("Google");
  const [codeQuestion, setCodeQuestion] =
    useState("");
  const [codeOutput, setCodeOutput] =
    useState("");
   const [language, setLanguage] =
    useState("javascript");
  const [code, setCode] =
    useState("");
  const [timeLeft, setTimeLeft] = useState(1800);
  const [codeScore, setCodeScore] =
    useState("");
  const [codeFeedback, setCodeFeedback] =
    useState("");
  const [optimizedCode, setOptimizedCode] =
    useState("");

  // =========================
  // CLEAN TEXT
  // =========================
  const cleanTextForSpeech = (text) => {

    return String(text || "")
      .replace(/#{1,6}\s?/g, "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/---/g, "")
      .replace(/`/g, "")
      .replace(/[>|]/g, "")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  // =========================
  // SPEAK QUESTION
  // =========================
  const speakQuestion = (text) => {

    const cleanedText = cleanTextForSpeech(text);

    const speech = new SpeechSynthesisUtterance(
      cleanedText
    );

    speech.lang = "en-US";

    speech.rate = 0.9;

    const voices =
      window.speechSynthesis.getVoices();

    const preferredVoice =
      voices.find((voice) =>
        voice.name.includes("Google US English")
      ) || voices[0];

    if (preferredVoice) {
      speech.voice = preferredVoice;
    }

    window.speechSynthesis.cancel();
    setAvatarSpeaking(true);

    speech.onend = () => {
      setAvatarSpeaking(false);
    };

    window.speechSynthesis.speak(speech);

    setCurrentQuestion(cleanedText);
  };

  // =========================
  // START LISTENING
  // =========================
  // =========================

  const startListening = (questionText) => {

    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {

      alert("Speech Recognition not supported");

      return;
    }

    // SET CURRENT QUESTION
    setCurrentQuestion(questionText);

    const recognition = new SpeechRecognition();

    recognition.lang = "en-US";

    recognition.interimResults = false;

    recognition.start();

    recognition.onresult = async (event) => {

      const transcript =
        event.results[0][0].transcript;

      try {

        const response = await axios.post(
          apiUrl("/evaluate-answer"),
          {
            question: questionText,
            answer: transcript,
            email: localStorage.getItem("email") || "test@gmail.com",
          }
        );
        console.log(response.data)

        setAnswers((prev) => [
          ...prev,
          {
            question: questionText,
            answer: transcript,
            score: toScore(response.data.score),
            feedback: response.data.feedback,
            improvements: response.data.improvements,
            ideal_answer: response.data.ideal_answer,
          },
        ]);

      } catch (error) {

        console.log(error.response?.data);

        alert("Evaluation Failed");
      }
    };
  };

  // =========================
  // UPLOAD RESUME
  // =========================
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
        apiUrl("/upload-resume"),
        formData
      );

      const safeQuestions = normalizeStringArray(
        response.data.ai_questions
      ).filter(
        (q) =>
          q.length > 10 &&
          !q.includes("Technical Interview Questions") &&
          !q.includes("HR Interview Questions") &&
          !q.includes("Project-Based Questions") &&
          !q.includes("---") &&
          !q.includes("Good luck")
      );

      setQuestions(safeQuestions);
      const codingResponse = await axios.post(
      apiUrl("/generate-coding-question"),
      {
        resume: response.data.resume_text,
        company: companyMode,
      }
    );
    

    setCodeQuestion(
      Array.isArray(codingResponse.data.question)
        ? codingResponse.data.question.join("\n")
        : codingResponse.data.question
    );
    setAtsScore(
      toScore(response.data.ats_score)
    );

    setMissingSkills(
      normalizeStringArray(response.data.missing_skills)
    );

    } catch (error) {

      console.log(error);

      alert("Upload Failed");

    } finally {

      setLoading(false);
    }
  };

  // =========================
  // SIGNUP
  // =========================
  const handleSignup = async () => {

    try {

      const response = await axios.post(
        apiUrl("/signup"),
        {
          name,
          email,
          password,
        }
      );

      setMessage(response.data.message);

    } catch {

      setMessage("Signup failed");
    }
  };

  // =========================
  // LOGIN
  // =========================
  const handleLogin = async () => {

    try {

      const response = await axios.post(
        apiUrl("/login"),
        {
          email,
          password,
        }
      );

      if (!response.data.token) {
        setMessage(response.data.message || "Login failed");
        return;
      }

      localStorage.setItem(
        "token",
        response.data.token
      );

      localStorage.setItem(
        "name",
        response.data.name
      );

      localStorage.setItem(
        "email",
        response.data.email
      );

      setIsAuthenticated(true);

    } catch {

      setMessage("Login failed");
    }
  };
  const fetchHistory = useCallback(async () => {

    try {

      const response = await axios.get(
        apiUrl(`/history/${
          localStorage.getItem("email")
        }`)
      );

      const scores = response.data.map(
        (item) => toScore(item.score)
      );

      if (scores.length > 0) {

        const avg =
          scores.reduce((a, b) => a + b, 0)
          / scores.length;

        setAverageScore(
          avg.toFixed(1)
        );

        setBestScore(
          Math.max(...scores)
        );

        setTotalInterviews(
          scores.length
        );
      }

    } catch (error) {

      console.log(error);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      const timer = setTimeout(fetchHistory, 0);

      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, fetchHistory]);

  // =========================
  // LOGOUT
  // =========================
  const handleLogout = () => {

    localStorage.removeItem("token");

    localStorage.removeItem("name");

    localStorage.removeItem("email");

    setIsAuthenticated(false);
  };
  // =========================
  // TIMER
  // =========================

  useEffect(() => {

    const timer = setInterval(() => {

      setTimeLeft((prev) => {

        if (prev <= 0) {

          clearInterval(timer);

          return 0;
        }

        return prev - 1;
      });

    }, 1000);

    return () => clearInterval(timer);

  }, []);

const formatTime = (seconds) => {

  const mins = Math.floor(seconds / 60);

  const secs = seconds % 60;

  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
};
const analyticsData = answers.map(
  (item, index) => ({
    name: `Q${index + 1}`,
    score: item.score,
  })
);

  // =========================
  // FILTER QUESTIONS
  // =========================
  const filteredQuestions = questions.filter((q) => {
    const question = String(q || "");

    if (selectedCategory === "All") {
      return true;
    }

    return question
      .toLowerCase()
      .includes(selectedCategory.toLowerCase());
  });

  return (

    <div className="min-h-screen bg-slate-950 text-white p-6">

      {

        isAuthenticated ? (

          <div className="max-w-6xl mx-auto">

            {/* TOP BAR */}
            <div className="flex justify-between items-center mb-10">

              <h2 className="text-2xl font-bold">
                Welcome, {localStorage.getItem("name")}
              </h2>

              <button
                onClick={handleLogout}
                className="bg-red-600 hover:bg-red-700 px-5 py-2 rounded-xl"
              >
                Logout
              </button>
              <button
                onClick={() => {
                  window.open(
                    apiUrl(`/download-report/${localStorage.getItem("email")}`)
                  );
                }}
                className="bg-green-600 hover:bg-green-700 px-5 py-2 rounded-xl"
              >
                Download Report
              </button>

            </div>

            {/* HEADER */}
            <h1 className="text-5xl font-bold text-center mb-3">
              AI Mock Interview
            </h1>

            <p className="text-center text-gray-400 mb-10">
              Upload Resume - AI Questions - Voice Answers
            </p>

            {/* SCORE CARD */}
            <div className="bg-gradient-to-r from-blue-700 to-purple-700 p-6 rounded-2xl mb-8 shadow-2xl">

              <h2 className="text-3xl font-bold mb-2">
                Overall Performance
              </h2>

              <p className="text-xl">
                Average Score:
                <span className="font-bold text-yellow-300 ml-2">
                  {averageScore}/10
                </span>
              </p>

            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">

              <div className="bg-slate-900 p-6 rounded-2xl border border-slate-700">

                <h3 className="text-gray-400 mb-2">
                  Total Interviews
                </h3>

                <p className="text-5xl font-bold text-cyan-400">
                  {totalInterviews}
                </p>

              </div>

              <div className="bg-slate-900 p-6 rounded-2xl border border-slate-700">

                <h3 className="text-gray-400 mb-2">
                  Average Score
                </h3>

                <p className="text-5xl font-bold text-yellow-400">
                  {averageScore}
                </p>

              </div>

              <div className="bg-slate-900 p-6 rounded-2xl border border-slate-700">

                <h3 className="text-gray-400 mb-2">
                  Best Score
                </h3>

                <p className="text-5xl font-bold text-green-400">
                  {bestScore}
                </p>

              </div>

            </div>

            {/* UPLOAD */}
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
              <div className="mt-6">

                <label className="block mb-2 text-lg font-semibold">
                  Select Company Mode
                </label>

                <select
                  value={companyMode}
                  onChange={(e) =>
                    setCompanyMode(e.target.value)
                  }
                  className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl"
                >

                  <option>Google</option>
                  <option>Amazon</option>
                  <option>Microsoft</option>
                  <option>TCS</option>
                  <option>Infosys</option>
                  <option>Startup</option>

                </select>

              </div>

              <button
                onClick={handleUpload}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 py-3 rounded-xl text-lg font-semibold"
              >
                {
                  loading
                    ? "Generating Questions..."
                    : "Generate Interview Questions"
                }
              </button>

            </div>
            <div className="mt-8 bg-slate-900 p-8 rounded-2xl border border-slate-700">

              <h2 className="text-3xl font-bold text-cyan-400 mb-6">
                Resume ATS Analysis
              </h2>

              <div className="flex items-center gap-10">

                <div>

                  <h3 className="text-gray-400 mb-2">
                    ATS Score
                  </h3>

                  <div className="text-6xl font-bold text-green-400">
                    {atsScore}%
                  </div>

                </div>

                <div>

                  <h3 className="text-gray-400 mb-3">
                    Missing Skills
                  </h3>

                  <div className="flex flex-wrap gap-3">

                    {
                      missingSkills.map(
                        (skill, index) => (
                          <span
                            key={index}
                            className="bg-red-600 px-4 py-2 rounded-xl"
                          >
                            {skill}
                          </span>
                        )
                      )
                    }

                  </div>

                </div>

              </div>

            </div>

            {/* FILTER */}
            <div className="mt-8 flex gap-4">

              <button
                onClick={() =>
                  setSelectedCategory("All")
                }
                className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg"
              >
                All
              </button>

              <button
                onClick={() =>
                  setSelectedCategory("technical")
                }
                className="bg-blue-700 hover:bg-blue-600 px-4 py-2 rounded-lg"
              >
                Technical
              </button>

              <button
                onClick={() =>
                  setSelectedCategory("project")
                }
                className="bg-green-700 hover:bg-green-600 px-4 py-2 rounded-lg"
              >
                Project
              </button>

              <button
                onClick={() =>
                  setSelectedCategory("hr")
                }
                className="bg-purple-700 hover:bg-purple-600 px-4 py-2 rounded-lg"
              >
                HR
              </button>

            </div>
            <div className="mt-10 flex justify-center">

              <div className="bg-slate-900 p-8 rounded-3xl border border-slate-700 text-center w-full max-w-md">

                <div
                  className={`w-40 h-40 mx-auto rounded-full flex items-center justify-center text-6xl transition-all duration-300 ${
                    avatarSpeaking
                      ? "bg-green-500 scale-110"
                      : "bg-blue-600"
                  }`}
                >

                  AI

                </div>

                <h2 className="text-2xl font-bold mt-6 text-cyan-400">
                  AI Interviewer
                </h2>

                <p className="text-gray-400 mt-3">

                  {
                    avatarSpeaking
                      ? "Speaking..."
                      : "Waiting..."
                  }

                </p>

                <div className="mt-6 bg-slate-800 p-4 rounded-xl min-h-[100px]">

                  <p className="text-gray-300">

                    {
                      currentQuestion ||
                      "Your interview question will appear here..."
                    }

                  </p>

                </div>

              </div>

            </div>

            {/* QUESTIONS */}
            {

              filteredQuestions.length > 0 && (

                <div className="mt-10 bg-slate-900 border border-slate-700 rounded-2xl p-8 shadow-2xl">

                  <h2 className="text-3xl font-bold mb-6 text-blue-400">
                    AI Interview Questions
                  </h2>

                  <div className="space-y-6">

                    {

                      filteredQuestions.map((q, index) => (

                        <div
                          key={index}
                          className="bg-slate-800 p-5 rounded-xl border border-slate-700"
                        >

                          <p className="text-gray-200 mb-4 leading-8">
                            {q}
                          </p>

                          <div className="flex gap-4">

                            <button
                              onClick={() =>
                                speakQuestion(q)
                              }
                              className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg"
                            >
                              Speak
                            </button>

                            <button
                              onClick={() => startListening(q)}
                              className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg"
                            >
                              Answer
                            </button>

                          </div>

                        </div>
                      ))
                    }

                  </div>

                </div>
              )
            }
            {/* =========================
            LIVE CODING ROUND
            ========================= */}

            <div className="mt-10 bg-slate-900 border border-slate-700 rounded-2xl p-8 shadow-2xl">

              <h2 className="text-3xl font-bold mb-6 text-orange-400">
                Live Coding Round
              </h2>
              <div className="mb-4 text-xl font-bold text-red-400">
                Time Left: {formatTime(timeLeft)}
              </div>

              <div className="bg-slate-800 p-5 rounded-xl mb-6">

                <p className="text-lg text-gray-200 leading-8">
                  {codeQuestion}
                </p>

              </div>
              <select
                value={language}
                onChange={(e) =>
                  setLanguage(e.target.value)
                }
                className="mb-4 bg-slate-800 border border-slate-700 p-3 rounded-xl"
              >
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="java">Java</option>
                <option value="cpp">C++</option>
              </select>

              <Editor
                height="400px"
                language={language}
                theme="vs-dark"
                value={code}
                onChange={(value) => setCode(value || "")}
              />

              <button
                onClick={async () => {

                  try {

                    // RUN USER CODE
                    const response =
                      await axios.post(
                        apiUrl("/run-code"),
                        {
                          code,
                          language,
                        }
                      );

                    setCodeOutput(
                      response.data.output
                    );

                    // AI REVIEW
                    const reviewResponse =
                      await axios.post(
                        apiUrl("/evaluate-code"),
                        {
                          question:
                            codeQuestion,
                          code: code,
                        }
                      );

                    setCodeScore(
                      reviewResponse.data.score
                    );

                    setCodeFeedback(
                      reviewResponse.data.feedback
                    );

                    setOptimizedCode(
                      reviewResponse.data.optimized_code
                    );

                  } catch (error) {

                    console.log(error);

                    setCodeOutput(
                      "Execution Error"
                    );
                  }
                }}
                className="mt-6 bg-orange-600 hover:bg-orange-700 px-6 py-3 rounded-xl font-bold"
              >
                Run Code
              </button>

              {

                codeOutput && (

                  <div className="mt-6 bg-slate-800 p-5 rounded-xl">

                    <h3 className="text-xl font-bold text-green-400 mb-3">
                      Output
                    </h3>

                    <p className="text-gray-300">
                      {codeOutput}
                    </p>

                  </div>
                )
              }
              {
                codeScore && (

                  <div className="mt-6 bg-slate-800 p-5 rounded-xl">

                    <h3 className="text-2xl font-bold text-yellow-400 mb-4">
                      AI Code Review
                    </h3>

                    <p className="text-xl mb-4">
                      Score:
                      <span className="text-yellow-300 font-bold ml-2">
                        {codeScore}/10
                      </span>
                    </p>

                    <h4 className="text-green-400 font-bold mb-2">
                      Feedback
                    </h4>

                    <p className="text-gray-300 mb-5 leading-8">
                      {codeFeedback}
                    </p>

                    <h4 className="text-cyan-400 font-bold mb-2">
                      Optimized Solution
                    </h4>

                    <pre className="bg-black p-4 rounded-xl overflow-x-auto text-sm text-green-300">
                      {optimizedCode}
                    </pre>

                  </div>
                )
              }

            </div>
            <div className="mt-10 bg-slate-900 p-8 rounded-2xl border border-slate-700">

              <h2 className="text-3xl font-bold mb-8 text-yellow-400">
                Performance Dashboard
              </h2>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">

                <div className="bg-slate-800 p-6 rounded-xl">
                  <h3 className="text-gray-400">
                    Total Questions
                  </h3>

                  <p className="text-3xl font-bold text-blue-400">
                    {answers.length}
                  </p>
                </div>

                <div className="bg-slate-800 p-6 rounded-xl">
                  <h3 className="text-gray-400">
                    Average Score
                  </h3>

                  <p className="text-3xl font-bold text-green-400">
                    {
                      answers.length > 0
                        ? (
                            answers.reduce(
                              (a, b) => a + b.score,
                              0
                            ) / answers.length
                          ).toFixed(1)
                        : 0
                    }
                  </p>
                </div>

                <div className="bg-slate-800 p-6 rounded-xl">
                  <h3 className="text-gray-400">
                    Best Score
                  </h3>

                  <p className="text-3xl font-bold text-purple-400">
                    {
                      answers.length > 0
                        ? Math.max(
                            ...answers.map(
                              (a) => a.score
                            )
                          )
                        : 0
                    }
                  </p>
                </div>

                <div className="bg-slate-800 p-6 rounded-xl">
                  <h3 className="text-gray-400">
                    Coding Round
                  </h3>

                  <p className="text-3xl font-bold text-orange-400">
                    Completed
                  </p>
                </div>

              </div>

              <div className="bg-slate-800 p-6 rounded-xl">

                <ResponsiveContainer
                  width="100%"
                  height={300}
                >

                  <BarChart data={analyticsData}>

                    <XAxis dataKey="name" />

                    <YAxis />

                    <Tooltip />

                    <Bar dataKey="score" />

                  </BarChart>

                </ResponsiveContainer>

              </div>

            </div>

            {/* ANSWERS */}
            {

              answers.length > 0 && (

                <div className="mt-10 bg-slate-900 border border-slate-700 rounded-2xl p-8">

                  <h2 className="text-3xl font-bold mb-6 text-green-400">
                    AI Feedback Report
                  </h2>

                  <div className="space-y-8">

                    {

                      answers.map((item, index) => (

                        <div
                          key={index}
                          className="bg-slate-800 p-6 rounded-xl border border-slate-700"
                        >

                          <h3 className="text-xl font-bold text-blue-400 mb-2">
                            Question
                          </h3>

                          <p className="text-gray-300 mb-5 leading-8">
                            {item.question}
                          </p>

                          <h3 className="text-xl font-bold text-green-400 mb-2">
                            Your Answer
                          </h3>

                          <p className="text-gray-300 mb-5 leading-8">
                            {item.answer}
                          </p>

                          <h3 className="text-xl font-bold text-yellow-400 mb-2">
                            Interview Score
                          </h3>

                          <p className="text-yellow-300 mb-5 text-2xl font-bold">
                            {item.score}/10
                          </p>

                          <h3 className="text-xl font-bold text-purple-400 mb-2">
                            AI Feedback
                          </h3>

                          <p className="text-gray-300 mb-5 leading-8">
                            {item.feedback}
                          </p>

                          <h3 className="text-xl font-bold text-red-400 mb-2">
                            Improvements
                          </h3>

                          <p className="text-gray-300 mb-5 leading-8">
                            {item.improvements}
                          </p>

                          <h3 className="text-xl font-bold text-cyan-400 mb-2">
                            Ideal Answer
                          </h3>

                          <p className="text-gray-300 leading-8">
                            {item.ideal_answer}
                          </p>

                        </div>
                      ))
                    }

                  </div>

                </div>
              )
            }

          </div>

        ) : (

          <div className="container">

            <div className="card">

              <h1>AI Mock Interview</h1>

              <h2>
                {isLogin ? "Login" : "Signup"}
              </h2>

              {

                !isLogin && (

                  <input
                    type="text"
                    placeholder="Name"
                    value={name}
                    onChange={(e) =>
                      setName(e.target.value)
                    }
                  />
                )
              }

              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
              />

              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
              />

              {

                isLogin ? (

                  <button onClick={handleLogin}>
                    Login
                  </button>

                ) : (

                  <button onClick={handleSignup}>
                    Signup
                  </button>
                )
              }

              <p>{message}</p>

              <button
                className="switchBtn"
                onClick={() =>
                  setIsLogin(!isLogin)
                }
              >

                {
                  isLogin
                    ? "Create new account"
                    : "Already have account?"
                }

              </button>

            </div>

          </div>
        )
      }

    </div>
  );
}

export default App;
