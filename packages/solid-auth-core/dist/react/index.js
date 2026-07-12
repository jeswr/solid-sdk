// src/react/index.tsx
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createSolidAuth } from "../index.js";
var SolidSessionContext = createContext(null);
function SessionProvider(props) {
  const { children } = props;
  const authRef = useRef(null);
  if (authRef.current === null) {
    authRef.current = props.auth ?? createSolidAuth(props.config);
  }
  const auth = authRef.current;
  const [status, setStatus] = useState("restoring");
  const [webId, setWebId] = useState(auth.webId);
  const [error, setError] = useState(null);
  useEffect(() => {
    let disposed = false;
    const unsubscribe = auth.onSessionChange(({ webId: current }) => {
      if (disposed) return;
      setWebId(current);
      setStatus(current !== null ? "authenticated" : "unauthenticated");
    });
    void auth.restore().catch(() => ({ outcome: "login" })).then((outcome) => {
      if (disposed) return;
      if (outcome.outcome === "restored") {
        setWebId(outcome.webId);
        setStatus("authenticated");
      } else {
        setWebId((prev) => prev ?? auth.webId);
        setStatus(auth.webId !== null ? "authenticated" : "unauthenticated");
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [auth]);
  const handles = useMemo(() => {
    const sessionFetch = ((input, init) => auth.authenticatedFetch(input, init));
    const login = async (target) => {
      setError(null);
      try {
        await auth.login(target);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    };
    const logout = async () => {
      setError(null);
      try {
        await auth.logout();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    };
    return { sessionFetch, login, logout };
  }, [auth]);
  const session = useMemo(
    () => ({
      status,
      webId,
      fetch: handles.sessionFetch,
      publicFetch: auth.publicFetch,
      login: handles.login,
      logout: handles.logout,
      error,
      auth
    }),
    [auth, handles, status, webId, error]
  );
  return createElement(SolidSessionContext.Provider, { value: session }, children);
}
function useSolidSession() {
  const session = useContext(SolidSessionContext);
  if (session === null) {
    throw new Error(
      "useSolidSession() must be used inside a <SessionProvider> (@jeswr/solid-auth-core/react). Mount one at your app root."
    );
  }
  return session;
}
export {
  SessionProvider,
  useSolidSession
};
//# sourceMappingURL=index.js.map
