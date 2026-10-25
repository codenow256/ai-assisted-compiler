import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../../src/app/App";
import { ProjectProvider } from "../../src/app/ProjectContext";
import examples from "./fixtures/examples.json";
import health from "./fixtures/health.json";
import semicolon from "./fixtures/repair_02_missing_semicolon.json";

export const fixtures = { examples, health, semicolon };

type Handler = (path: string, body: any) => unknown | Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Routes fetch() calls to handlers keyed by API path; unknown paths 404. */
export function mockApi(handlers: Record<string, Handler>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const path = url.replace(/^.*\/api/, "");
    const body = init?.body ? JSON.parse(init.body as string) : null;
    const h = handlers[path];
    if (!h) return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: path } }), { status: 404 });
    const result = await h(path, body);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), { status: 200 });
  });
}

export function defaultHandlers(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "/health": () => health,
    "/capabilities": () => ({ optional_baselines: { cpctplus: { available: false, reason: "test" } } }),
    "/examples": () => examples,
    "/grammar": () => ({ grammar_source: "", lexer_source: "", rules: [], states: 0, report_available: false, note: "" }),
    ...extra,
  };
}

export function renderApp(route: string, initialSource?: string, children?: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ProjectProvider initialSource={initialSource}>
        <AppRoutes />
        {children}
      </ProjectProvider>
    </MemoryRouter>,
  );
}
