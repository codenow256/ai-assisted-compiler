import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AstPage } from "../features/ast/AstPage";
import { DocsPage } from "../features/docs/DocsPage";
import { EvaluationPage } from "../features/evaluation/EvaluationPage";
import { HypothesesPage } from "../features/hypotheses/HypothesesPage";
import { LearningPage } from "../features/learning/LearningPage";
import { LexerPage } from "../features/lexer/LexerPage";
import { ParserPage } from "../features/parser/ParserPage";
import { RepairPage } from "../features/repair/RepairPage";
import { ResearchPage } from "../features/research/ResearchPage";
import { WorkspacePage } from "../features/workspace/WorkspacePage";
import { AppShell } from "./AppShell";
import { ProjectProvider } from "./ProjectContext";

// Three primary destinations (Workspace, AST Explorer, Research & Method).
// The specialist views stay available through contextual links.
export function AppRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<WorkspacePage />} />
        <Route path="/ast" element={<AstPage />} />
        <Route path="/research" element={<ResearchPage />} />
        {/* specialist views (linked from the Workspace and Research pages) */}
        <Route path="/lexer" element={<LexerPage />} />
        <Route path="/parser" element={<ParserPage />} />
        <Route path="/repair" element={<RepairPage />} />
        <Route path="/hypotheses" element={<HypothesesPage />} />
        <Route path="/evaluation" element={<EvaluationPage />} />
        <Route path="/learn" element={<LearningPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/docs/:name" element={<DocsPage />} />
        <Route path="/workbench" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ProjectProvider>
        <AppRoutes />
      </ProjectProvider>
    </BrowserRouter>
  );
}
