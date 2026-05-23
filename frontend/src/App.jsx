import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./App.css";

const Editor = lazy(() => import("@monaco-editor/react"));

const AnalyticsChart = lazy(() =>
  import("recharts").then(
    ({
      Area,
      CartesianGrid,
      ComposedChart,
      Bar,
      ResponsiveContainer,
      Tooltip,
      XAxis,
      YAxis,
    }) => ({
      default: function Chart({ data }) {
        return (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data}>
              <defs>
                <linearGradient id="scoreGlow" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.65} />
                  <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8" }} axisLine={false} tickLine={false} domain={[0, 10]} />
              <Tooltip
                cursor={{ fill: "rgba(45, 212, 191, 0.08)" }}
                contentStyle={{
                  background: "rgba(2, 6, 23, 0.92)",
                  border: "1px solid rgba(45, 212, 191, 0.25)",
                  borderRadius: 14,
                  color: "#e2e8f0",
                }}
              />
              <Area type="monotone" dataKey="score" stroke="#2dd4bf" strokeWidth={3} fill="url(#scoreGlow)" />
              <Bar dataKey="confidence" fill="#a78bfa" radius={[8, 8, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        );
      },
    }),
  ),
);

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://ai-mock-interview-ji82.onrender.com";

const apiUrl = (path) => `${API_BASE_URL}${path}`;

const categories = [
  "All",
  "Technical",
  "DSA",
  "HR",
  "System Design",
  "Projects",
  "Company-specific",
  "Adaptive",
];

const companies = ["Google", "Amazon", "Microsoft", "TCS", "Infosys", "Startup"];

const defaultStats = {
  streak: 6,
  xp: 1840,
  level: 7,
  sessionsToday: 1,
  dailyLimit: 3,
  dailyCompleted: false,
  leaderboardRank: 128,
  unlockedTheme: "Aurora Glass",
};

const fallbackChallenge = {
  title: "Adaptive Array Challenge",
  difficulty: "Medium",
  question:
    "Given an array of integers and a target, return the indexes of two values that add up to the target. Explain your time and space complexity.",
  examples: ["Input: nums = [2, 7, 11, 15], target = 9 | Output: [0, 1]"],
  test_cases: [
    { input: "[2,7,11,15], 9", expected: "[0,1]" },
    { input: "[3,2,4], 6", expected: "[1,2]" },
  ],
  hidden_tests: 5,
  hints: ["Use a hash map to store values you have already seen.", "Check the complement before storing the current value."],
  constraints: ["2 <= nums.length <= 10^5", "Exactly one valid answer exists."],
};

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
        return item.question || item.skill || item.title || JSON.stringify(item);
      }

      return "";
    })
    .map((item) => item.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter((item, index, array) => item && array.indexOf(item) === index);
};

const toScore = (value) => {
  const score = Number.parseFloat(value);

  return Number.isFinite(score) ? score : 0;
};

const categorizeQuestion = (question) => {
  const text = String(question).toLowerCase();

  if (text.includes("system") || text.includes("scale") || text.includes("architecture")) {
    return "System Design";
  }

  if (text.includes("array") || text.includes("string") || text.includes("hash") || text.includes("complexity")) {
    return "DSA";
  }

  if (text.includes("project") || text.includes("built") || text.includes("architecture")) {
    return "Projects";
  }

  if (text.includes("tell me") || text.includes("conflict") || text.includes("feedback") || text.includes("why")) {
    return "HR";
  }

  return "Technical";
};

const normalizeQuestionBank = (data) => {
  const bank = Array.isArray(data.question_bank) ? data.question_bank : [];
  const fromBank = bank
    .map((item, index) => ({
      id: item.id || index + 1,
      question: String(item.question || "").trim(),
      section: item.section || categorizeQuestion(item.question),
      difficulty: item.difficulty || "Medium",
    }))
    .filter((item) => item.question);

  if (fromBank.length > 0) {
    return fromBank;
  }

  return normalizeStringArray(data.ai_questions).map((question, index) => ({
    id: index + 1,
    question,
    section: categorizeQuestion(question),
    difficulty: index % 5 === 0 ? "Hard" : index % 3 === 0 ? "Easy" : "Medium",
  }));
};

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
};

function GlassCard({ children, className = "" }) {
  return <section className={`glass-card ${className}`}>{children}</section>;
}

function MetricCard({ label, value, detail, tone = "cyan", locked = false }) {
  return (
    <GlassCard className="metric-card">
      <div className={`metric-glow metric-${tone}`} />
      <div className="metric-label">{label}</div>
      <div className="metric-value">{locked ? "Locked" : value}</div>
      <div className="metric-detail">{detail}</div>
    </GlassCard>
  );
}

function SkeletonPanel() {
  return (
    <GlassCard className="skeleton-wrap">
      <div className="skeleton-line wide" />
      <div className="skeleton-grid">
        <div className="skeleton-block" />
        <div className="skeleton-block" />
        <div className="skeleton-block" />
      </div>
      <div className="skeleton-line" />
      <div className="skeleton-line short" />
    </GlassCard>
  );
}

function AuthScreen({
  email,
  isLogin,
  message,
  name,
  password,
  setEmail,
  setIsLogin,
  setName,
  setPassword,
  onLogin,
  onSignup,
}) {
  return (
    <main className="auth-page">
      <section className="auth-hero">
        <div className="brand-pill">InterviewOS AI</div>
        <h1>Practice like the offer depends on today.</h1>
        <p>
          A premium AI interview gym with resume-aware questions, coding rounds, ATS coaching,
          streaks, XP, and career roadmaps in one focused workspace.
        </p>
        <div className="onboarding-steps">
          {["Upload resume", "Get AI diagnostic", "Practice daily", "Unlock offers"].map((step, index) => (
            <div className="step-card" key={step}>
              <span>0{index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
        <div className="social-proof">
          <span>92%</span>
          <p>users complete more sessions when streaks and daily challenges are visible.</p>
        </div>
      </section>

      <section className="auth-panel glass-card">
        <div>
          <p className="eyebrow">Premium onboarding</p>
          <h2>{isLogin ? "Welcome back" : "Create your practice cockpit"}</h2>
        </div>

        {!isLogin && (
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Yash Kumar" />
          </label>
        )}

        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" />
        </label>

        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            type="password"
          />
        </label>

        <button className="primary-action" onClick={isLogin ? onLogin : onSignup}>
          {isLogin ? "Enter dashboard" : "Start free"}
        </button>

        {message && <p className="form-message">{message}</p>}

        <button className="ghost-action" onClick={() => setIsLogin(!isLogin)}>
          {isLogin ? "Create a new account" : "Already have an account?"}
        </button>

        <div className="auth-limits">
          <strong>Free plan</strong>
          <span>3 interview sets/day</span>
          <span>1 coding review/day</span>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(Boolean(localStorage.getItem("token")));
  const [activeView, setActiveView] = useState("dashboard");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [questionBank, setQuestionBank] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [companyMode, setCompanyMode] = useState("Google");
  const [targetRole, setTargetRole] = useState("Frontend Engineer");
  const [analysis, setAnalysis] = useState(null);
  const [codingChallenge, setCodingChallenge] = useState(fallbackChallenge);
  const [codeOutput, setCodeOutput] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [code, setCode] = useState("// Start with a clear function signature.\n");
  const [timeLeft, setTimeLeft] = useState(1800);
  const [codeScore, setCodeScore] = useState("");
  const [codeFeedback, setCodeFeedback] = useState("");
  const [optimizedCode, setOptimizedCode] = useState("");
  const [complexity, setComplexity] = useState({ time: "", space: "", hint: "" });
  const [revealedHints, setRevealedHints] = useState(1);
  const [stats, setStats] = useState(() => {
    const saved = localStorage.getItem("interviewos_stats");

    return saved ? JSON.parse(saved) : defaultStats;
  });

  useEffect(() => {
    localStorage.setItem("interviewos_stats", JSON.stringify(stats));
  }, [stats]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev <= 0 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const cleanTextForSpeech = (text) =>
    String(text || "")
      .replace(/#{1,6}\s?/g, "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/---/g, "")
      .replace(/`/g, "")
      .replace(/[>|]/g, "")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const fetchHistory = useCallback(async () => {
    try {
      const userEmail = localStorage.getItem("email");

      if (!userEmail) {
        return;
      }

      const response = await axios.get(apiUrl(`/history/${userEmail}`));
      const scores = response.data.map((item) => toScore(item.score));

      if (scores.length > 0) {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

        setAnswers((prev) => (prev.length > 0 ? prev : response.data));
        setStats((prev) => ({
          ...prev,
          level: Math.max(prev.level, Math.floor(avg) || prev.level),
        }));
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      const timer = setTimeout(fetchHistory, 0);

      return () => clearTimeout(timer);
    }

    return undefined;
  }, [fetchHistory, isAuthenticated]);

  const analyticsData = useMemo(() => {
    const source = answers.length
      ? answers
      : [
          { score: 6, confidence_score: 5 },
          { score: 7, confidence_score: 6 },
          { score: 8, confidence_score: 7 },
        ];

    return source.map((item, index) => ({
      name: `Q${index + 1}`,
      score: toScore(item.score),
      confidence: toScore(item.confidence_score || item.score),
    }));
  }, [answers]);

  const averageScore = useMemo(() => {
    if (answers.length === 0) {
      return 0;
    }

    return (answers.reduce((total, item) => total + toScore(item.score), 0) / answers.length).toFixed(1);
  }, [answers]);

  const bestScore = useMemo(() => {
    if (answers.length === 0) {
      return 0;
    }

    return Math.max(...answers.map((item) => toScore(item.score)));
  }, [answers]);

  const filteredQuestions = useMemo(
    () =>
      questionBank.filter((item) =>
        selectedCategory === "All" ? true : item.section.toLowerCase() === selectedCategory.toLowerCase(),
      ),
    [questionBank, selectedCategory],
  );

  const sectionStats = useMemo(
    () =>
      categories.slice(1).map((section) => ({
        section,
        count: questionBank.filter((item) => item.section.toLowerCase() === section.toLowerCase()).length,
      })),
    [questionBank],
  );

  const handleSignup = async () => {
    try {
      const response = await axios.post(apiUrl("/signup"), { name, email, password });
      setMessage(response.data.message);
      setIsLogin(true);
    } catch (error) {
      setMessage(error.response?.data?.detail || "Signup failed");
    }
  };

  const handleLogin = async () => {
    try {
      const response = await axios.post(apiUrl("/login"), { email, password });

      if (!response.data.token) {
        setMessage(response.data.message || "Login failed");
        return;
      }

      localStorage.setItem("token", response.data.token);
      localStorage.setItem("name", response.data.name);
      localStorage.setItem("email", response.data.email);
      setIsAuthenticated(true);
      setMessage("");
    } catch (error) {
      setMessage(error.response?.data?.detail || "Login failed");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("name");
    localStorage.removeItem("email");
    setIsAuthenticated(false);
  };

  const handleUpload = async () => {
    if (!file) {
      alert("Please select a PDF resume");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      setLoading(true);
      setActiveView("interview");

      const response = await axios.post(apiUrl("/upload-resume"), formData);
      const nextAnalysis = response.data;
      const nextBank = normalizeQuestionBank(nextAnalysis);

      setAnalysis(nextAnalysis);
      setQuestionBank(nextBank);
      setStats((prev) => ({
        ...prev,
        xp: prev.xp + toScore(nextAnalysis.xp_reward || 120),
        sessionsToday: Math.min(prev.sessionsToday + 1, prev.dailyLimit),
      }));

      const codingResponse = await axios.post(apiUrl("/generate-coding-question"), {
        resume: nextAnalysis.resume_text,
        company: companyMode,
      });

      setCodingChallenge({
        ...fallbackChallenge,
        ...codingResponse.data,
        examples: normalizeStringArray(codingResponse.data.examples).length
          ? normalizeStringArray(codingResponse.data.examples)
          : fallbackChallenge.examples,
        hints: normalizeStringArray(codingResponse.data.hints).length
          ? normalizeStringArray(codingResponse.data.hints)
          : fallbackChallenge.hints,
        constraints: normalizeStringArray(codingResponse.data.constraints).length
          ? normalizeStringArray(codingResponse.data.constraints)
          : fallbackChallenge.constraints,
        test_cases: Array.isArray(codingResponse.data.test_cases)
          ? codingResponse.data.test_cases
          : fallbackChallenge.test_cases,
      });
      setRevealedHints(1);
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.detail || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const speakQuestion = (text) => {
    const cleanedText = cleanTextForSpeech(text);
    const speech = new SpeechSynthesisUtterance(cleanedText);
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find((voice) => voice.name.includes("Google US English")) || voices[0];

    speech.lang = "en-US";
    speech.rate = 0.92;

    if (preferredVoice) {
      speech.voice = preferredVoice;
    }

    window.speechSynthesis.cancel();
    setAvatarSpeaking(true);
    setCurrentQuestion(cleanedText);
    speech.onend = () => setAvatarSpeaking(false);
    window.speechSynthesis.speak(speech);
  };

  const startListening = (questionItem) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech Recognition is not supported in this browser.");
      return;
    }

    setCurrentQuestion(questionItem.question);
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.start();

    recognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript;

      try {
        const response = await axios.post(apiUrl("/evaluate-answer"), {
          question: questionItem.question,
          answer: transcript,
          email: localStorage.getItem("email") || "test@gmail.com",
        });
        const evaluated = {
          question: questionItem.question,
          answer: transcript,
          score: toScore(response.data.score),
          feedback: response.data.feedback,
          improvements: response.data.improvements,
          ideal_answer: response.data.ideal_answer,
          confidence_score: toScore(response.data.confidence_score),
          communication_score: toScore(response.data.communication_score),
          personality_insight: response.data.personality_insight,
          next_question: response.data.next_question,
        };

        setAnswers((prev) => [...prev, evaluated]);
        setStats((prev) => ({
          ...prev,
          xp: prev.xp + 35,
          dailyCompleted: true,
          streak: prev.dailyCompleted ? prev.streak : prev.streak + 1,
        }));

        if (response.data.next_question) {
          setQuestionBank((prev) => [
            ...prev,
            {
              id: prev.length + 1,
              question: response.data.next_question,
              section: "Adaptive",
              difficulty: "Hard",
            },
          ]);
        }
      } catch (error) {
        console.error(error);
        alert("Evaluation failed");
      }
    };
  };

  const runCode = async () => {
    try {
      const response = await axios.post(apiUrl("/run-code"), { code, language });
      setCodeOutput(response.data.output || "Code executed with no output.");

      const reviewResponse = await axios.post(apiUrl("/evaluate-code"), {
        question: codingChallenge.question,
        code,
        language,
      });

      setCodeScore(reviewResponse.data.score);
      setCodeFeedback(reviewResponse.data.feedback);
      setOptimizedCode(reviewResponse.data.optimized_code);
      setComplexity({
        time: reviewResponse.data.time_complexity,
        space: reviewResponse.data.space_complexity,
        hint: reviewResponse.data.hint,
      });
      setStats((prev) => ({ ...prev, xp: prev.xp + 60 }));
    } catch (error) {
      console.error(error);
      setCodeOutput("Execution Error");
    }
  };

  if (!isAuthenticated) {
    return (
      <AuthScreen
        email={email}
        isLogin={isLogin}
        message={message}
        name={name}
        password={password}
        setEmail={setEmail}
        setIsLogin={setIsLogin}
        setName={setName}
        setPassword={setPassword}
        onLogin={handleLogin}
        onSignup={handleSignup}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand-lockup">
          <div className="brand-mark">IO</div>
          <div>
            <strong>InterviewOS</strong>
            <span>AI interview operating system</span>
          </div>
        </div>
        <nav>
          {["dashboard", "interview", "coding", "premium"].map((view) => (
            <button className={activeView === view ? "nav-active" : ""} key={view} onClick={() => setActiveView(view)}>
              {view}
            </button>
          ))}
        </nav>
        <div className="nav-actions">
          <button className="ghost-action compact" onClick={() => window.open(apiUrl(`/download-report/${localStorage.getItem("email")}`))}>
            Report
          </button>
          <button className="danger-action" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <main className="product-layout">
        <section className="hero-panel">
          <div className="hero-copy">
            <div className="brand-pill">Daily AI interview gym</div>
            <h1>Turn resume anxiety into a daily practice loop.</h1>
            <p>
              Upload once, unlock personalized interview paths, adaptive voice coaching, coding drills,
              XP streaks, ATS insights, and premium readiness reports.
            </p>
            <div className="hero-actions">
              <label className="file-drop">
                <span>{file ? file.name : "Drop or choose resume PDF"}</span>
                <input accept=".pdf" type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              </label>
              <select value={companyMode} onChange={(event) => setCompanyMode(event.target.value)}>
                {companies.map((company) => (
                  <option key={company}>{company}</option>
                ))}
              </select>
              <input value={targetRole} onChange={(event) => setTargetRole(event.target.value)} />
              <button className="primary-action" disabled={loading} onClick={handleUpload}>
                {loading ? "Building plan..." : "Generate premium plan"}
              </button>
            </div>
          </div>

          <div className="avatar-stage">
            <div className={`ai-avatar ${avatarSpeaking ? "speaking" : ""}`}>
              <div className="avatar-face">
                <span />
                <span />
              </div>
            </div>
            <div className="voice-card">
              <strong>AI Coach</strong>
              <p>{currentQuestion || "Ready to turn your resume into a personalized practice path."}</p>
            </div>
          </div>
        </section>

        {loading && <SkeletonPanel />}

        {activeView === "dashboard" && (
          <>
            <section className="metric-grid">
              <MetricCard label="ATS Score" value={`${analysis?.ats_score || 0}%`} detail="Resume-market fit" tone="green" />
              <MetricCard label="Average" value={`${averageScore}/10`} detail="Interview performance" tone="cyan" />
              <MetricCard label="Best" value={`${bestScore}/10`} detail="Peak answer quality" tone="purple" />
              <MetricCard label="Streak" value={`${stats.streak} days`} detail="Daily practice loop" tone="orange" />
              <MetricCard label="XP" value={stats.xp.toLocaleString()} detail={`Level ${stats.level} candidate`} tone="purple" />
              <MetricCard label="Rank" value={`#${stats.leaderboardRank}`} detail="Global leaderboard" tone="cyan" />
            </section>

            <section className="two-column">
              <GlassCard className="dashboard-card">
                <div className="section-heading">
                  <p className="eyebrow">Personal AI diagnostic</p>
                  <h2>Readiness cockpit</h2>
                </div>
                <div className="progress-row">
                  <span>Free usage today</span>
                  <strong>
                    {stats.sessionsToday}/{stats.dailyLimit}
                  </strong>
                </div>
                <div className="usage-bar">
                  <span style={{ width: `${Math.min((stats.sessionsToday / stats.dailyLimit) * 100, 100)}%` }} />
                </div>
                <div className="insight-grid">
                  <div>
                    <strong>Confidence</strong>
                    <p>{analysis?.confidence_analysis || "Upload your resume to unlock confidence signals."}</p>
                  </div>
                  <div>
                    <strong>Communication</strong>
                    <p>{analysis?.communication_analysis || "Voice answers will reveal clarity, structure, and ownership."}</p>
                  </div>
                  <div>
                    <strong>Personality</strong>
                    <p>{analysis?.personality_insights || "The coach will identify your interview style and risk signals."}</p>
                  </div>
                </div>
              </GlassCard>

              <GlassCard className="dashboard-card">
                <div className="section-heading">
                  <p className="eyebrow">Daily retention loop</p>
                  <h2>Today’s challenge</h2>
                </div>
                <p className="daily-challenge">
                  {analysis?.daily_challenge || "Upload a resume, answer one project question, and run one coding solution."}
                </p>
                <div className="badge-row">
                  {["7-day streak", "DSA Sprint", "Resume Optimizer", stats.unlockedTheme].map((badge, index) => (
                    <span className={index === 3 ? "badge locked" : "badge"} key={badge}>
                      {badge}
                    </span>
                  ))}
                </div>
                <div className="level-card">
                  <span>Interview Level</span>
                  <strong>{stats.level}</strong>
                  <p>{1000 - (stats.xp % 1000)} XP until next unlock</p>
                </div>
              </GlassCard>
            </section>

            <GlassCard className="dashboard-card">
              <div className="section-heading">
                <p className="eyebrow">Progress tracking</p>
                <h2>Score and confidence trend</h2>
              </div>
              <Suspense fallback={<div className="chart-fallback">Loading interactive chart...</div>}>
                <AnalyticsChart data={analyticsData} />
              </Suspense>
            </GlassCard>

            <section className="three-column">
              <GlassCard>
                <h3>Strengths</h3>
                {(analysis?.strengths || ["Upload your resume to discover strengths."]).map((item) => (
                  <p className="list-chip positive" key={item}>{item}</p>
                ))}
              </GlassCard>
              <GlassCard>
                <h3>Weaknesses</h3>
                {(analysis?.weaknesses || ["Practice data required."]).map((item) => (
                  <p className="list-chip warning" key={item}>{item}</p>
                ))}
              </GlassCard>
              <GlassCard>
                <h3>Roadmap</h3>
                {(analysis?.career_roadmap || ["Resume upload", "Daily voice answer", "Coding drill"]).map((item) => (
                  <p className="roadmap-item" key={item}>{item}</p>
                ))}
              </GlassCard>
            </section>
          </>
        )}

        {activeView === "interview" && (
          <section className="interview-grid">
            <GlassCard className="question-panel">
              <div className="section-heading">
                <p className="eyebrow">{targetRole} path</p>
                <h2>Personalized question bank</h2>
              </div>
              <div className="category-tabs">
                {categories.map((category) => (
                  <button
                    className={selectedCategory === category ? "active" : ""}
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
              <div className="section-counts">
                {sectionStats.map((item) => (
                  <span key={item.section}>{item.section}: {item.count}</span>
                ))}
              </div>

              <div className="question-list">
                {(filteredQuestions.length ? filteredQuestions : questionBank).map((item) => (
                  <article className="question-card" key={`${item.id}-${item.question}`}>
                    <div className="question-meta">
                      <span>{item.section}</span>
                      <span className={`difficulty ${item.difficulty.toLowerCase()}`}>{item.difficulty}</span>
                    </div>
                    <p>{item.question}</p>
                    <div className="card-actions">
                      <button onClick={() => speakQuestion(item.question)}>Speak</button>
                      <button onClick={() => startListening(item)}>Answer with voice</button>
                    </div>
                  </article>
                ))}
                {questionBank.length === 0 && (
                  <div className="empty-state">
                    Upload a resume to generate 20-30 resume-aware questions across Technical, DSA, HR,
                    System Design, Projects, and Company-specific rounds.
                  </div>
                )}
              </div>
            </GlassCard>

            <aside className="coach-rail">
              <GlassCard>
                <div className={`mini-avatar ${avatarSpeaking ? "speaking" : ""}`}>AI</div>
                <h3>Adaptive coach</h3>
                <p>{currentQuestion || "Answer one question to unlock adaptive follow-ups."}</p>
              </GlassCard>
              <GlassCard>
                <h3>Resume fixes</h3>
                {(analysis?.resume_suggestions || ["Add metrics", "Clarify scope", "Highlight impact"]).map((item) => (
                  <p className="roadmap-item" key={item}>{item}</p>
                ))}
              </GlassCard>
              <GlassCard className="premium-lock">
                <span>Premium</span>
                <h3>AI mock interviewer persona</h3>
                <p>Unlock Google, Amazon, startup CTO, and HR panel simulations.</p>
                <button>Upgrade to unlock</button>
              </GlassCard>
            </aside>
          </section>
        )}

        {activeView === "coding" && (
          <section className="coding-layout">
            <GlassCard className="problem-pane">
              <div className="problem-header">
                <div>
                  <p className="eyebrow">{companyMode} coding round</p>
                  <h2>{codingChallenge.title}</h2>
                </div>
                <span className={`difficulty ${String(codingChallenge.difficulty).toLowerCase()}`}>
                  {codingChallenge.difficulty}
                </span>
              </div>
              <p className="problem-text">{codingChallenge.question}</p>
              <div className="test-section">
                <h3>Examples</h3>
                {codingChallenge.examples.map((example) => (
                  <pre key={example}>{example}</pre>
                ))}
              </div>
              <div className="test-section">
                <h3>Visible tests</h3>
                {codingChallenge.test_cases.map((test, index) => (
                  <div className="test-case" key={`${test.input}-${index}`}>
                    <span>Input: {test.input}</span>
                    <strong>Expected: {test.expected}</strong>
                  </div>
                ))}
                <div className="locked-tests">{codingChallenge.hidden_tests} hidden tests on Premium Judge</div>
              </div>
              <div className="test-section">
                <h3>Real-time hints</h3>
                {codingChallenge.hints.slice(0, revealedHints).map((hint) => (
                  <p className="hint" key={hint}>{hint}</p>
                ))}
                {revealedHints < codingChallenge.hints.length && (
                  <button className="ghost-action compact" onClick={() => setRevealedHints((prev) => prev + 1)}>
                    Reveal next hint
                  </button>
                )}
              </div>
            </GlassCard>

            <GlassCard className="editor-pane">
              <div className="editor-toolbar">
                <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                  <option value="javascript">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="java">Java</option>
                  <option value="cpp">C++</option>
                </select>
                <span>Time left: {formatTime(timeLeft)}</span>
                <button className="primary-action compact" onClick={runCode}>Run + AI Review</button>
              </div>
              <Suspense fallback={<div className="editor-fallback">Loading Monaco editor...</div>}>
                <Editor height="430px" language={language} theme="vs-dark" value={code} onChange={(value) => setCode(value || "")} />
              </Suspense>
              <div className="output-grid">
                <div>
                  <h3>Output</h3>
                  <pre>{codeOutput || "Run your code to see execution output."}</pre>
                </div>
                <div>
                  <h3>AI review</h3>
                  <p>Score: <strong>{codeScore || 0}/10</strong></p>
                  <p>{codeFeedback || "Submit code to unlock correctness, edge cases, and clarity review."}</p>
                  <div className="complexity-row">
                    <span>Time: {complexity.time || "Pending"}</span>
                    <span>Space: {complexity.space || "Pending"}</span>
                  </div>
                </div>
              </div>
              {optimizedCode && (
                <div className="optimized-box">
                  <h3>Optimized solution</h3>
                  <pre>{optimizedCode}</pre>
                  <p>{complexity.hint}</p>
                </div>
              )}
            </GlassCard>
          </section>
        )}

        {activeView === "premium" && (
          <section className="premium-page">
            <GlassCard className="pricing-hero">
              <p className="eyebrow">Monetization ready</p>
              <h2>Turn serious candidates into subscribers.</h2>
              <p>
                Premium unlocks unlimited interview sets, hidden test judging, company personas,
                advanced ATS rewrites, downloadable reports, and leaderboard boosts.
              </p>
            </GlassCard>
            <div className="pricing-grid">
              {[
                ["Free", "$0", "3 interview sets/day", "1 coding review/day", "Basic ATS score"],
                ["Pro", "$19", "Unlimited adaptive mocks", "Premium coding judge", "AI resume rewrite"],
                ["Elite", "$49", "Company persona panels", "Offer readiness score", "Priority AI roadmap"],
              ].map(([plan, price, ...features]) => (
                <GlassCard className={plan === "Pro" ? "pricing-card featured" : "pricing-card"} key={plan}>
                  <span>{plan}</span>
                  <h3>{price}<small>/mo</small></h3>
                  {features.map((feature) => (
                    <p key={feature}>{feature}</p>
                  ))}
                  <button className={plan === "Pro" ? "primary-action" : "ghost-action"}>{plan === "Free" ? "Current plan" : "Upgrade"}</button>
                </GlassCard>
              ))}
            </div>
            <div className="theme-grid">
              {["Aurora Glass", "Terminal Focus", "Founder Black", "Neon Circuit"].map((theme, index) => (
                <GlassCard className="theme-card" key={theme}>
                  <span className={`theme-swatch theme-${index}`} />
                  <strong>{theme}</strong>
                  <p>{index === 0 ? "Unlocked" : "Premium unlock"}</p>
                </GlassCard>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
