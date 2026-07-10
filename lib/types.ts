// Shared types between the API routes and the client UI.

export type Role = "student" | "admin";

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
};

export type Topic = { id: string; name: string };
export type Subject = {
  id: string;
  name: string;
  color: string;
  soft: string;
  icon: string;
  topics: Topic[];
};

export type SyllabusFile = { id: string; name: string; subject: string; count: number };

export type ProgressEntry = {
  topicId: string;
  topicName: string;
  subject: string;
  icon: string;
  color: string;
  mastery: number;
  misconceptions: string[];
  lastSeen: number;
};

// ---- Tutor scaffold (learning canvas) --------------------------------------
export type ConceptMap = {
  core: string;
  keyConcepts: string[];
  related: string[];
  vocab: string[];
  applications: string[];
};
export type Layer = { level: number; title: string; text: string };
export type IB = { key: string; related: string; global: string; soi: string; atl?: string[] };
export type Misconception = { think: string; why: string };
export type Checkpoint = { level: number; question: string };
export type Reinforcement = {
  summary: string;
  application: string;
  challenge: string;
  trick: string;
  tip: string;
};

export type Scaffold = {
  cm?: ConceptMap;
  inquiry?: string[];
  layers?: Layer[];
  ib?: IB;
  miscon?: Misconception[];
  checkpoint?: Checkpoint;
  reinf?: Reinforcement;
  reflection?: string[];
};

export type TutorTurn = {
  say: string;
  stage?: number;
  scaffold: Scaffold;
  masteryDelta?: number;
};

// ---- Study tools -----------------------------------------------------------
export type QuizItem = {
  type: "mcq" | "short";
  question: string;
  options?: string[];
  answer: string;
  explanation: string;
};
export type Flashcard = { term: string; definition: string; example: string; ib_link: string };
export type VideoItem = {
  title: string;
  channel?: string;
  search_query?: string;
  video_id?: string;
  timestamp_seconds?: number;
  timestamp_label?: string;
  reason?: string;
  concept_covered?: string;
};
export type MindMap = {
  center: string;
  branches: { label: string; color: string; children: string[] }[];
};

export type ChatMessage = { role: "user" | "jarvis"; text: string };
