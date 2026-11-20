// AUTHORED-BY Codex GPT-6
/** Scenario data may propose a reply; the runtime's existing outbound gate still decides it. */
import type { HandlerContext, HandlerReply, OperationHandler } from "../runtime/operations.js";
export function withScriptedReplies(
  handler: OperationHandler,
  propose: (context: HandlerContext) => HandlerReply | undefined,
): OperationHandler {
  return new Proxy(handler, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      if (property === "onProposal" || property === "onInvoke") {
        return (context: HandlerContext, ...args: unknown[]) =>
          propose(context) ?? value.call(target, context, ...args);
      }
      return value.bind(target);
    },
  });
}
