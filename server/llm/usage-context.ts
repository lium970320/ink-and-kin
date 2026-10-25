import { AsyncLocalStorage } from "node:async_hooks";
import type { LLMProvider } from "./types";
export type UserUsageContext = Readonly<{ userId?: number; personaId?: number; route?: string; purpose?: string }>;
const scopes = new WeakMap<LLMProvider, { base: LLMProvider; context: UserUsageContext }>();

/** 每次创建独立透明对象；绝不把用户信息写入共享注册表实例。 */
export function scopeProvider(provider: LLMProvider, context: UserUsageContext): LLMProvider {
  if (context.userId !== undefined && (!Number.isSafeInteger(context.userId) || context.userId < 1)) throw new Error("Invalid usage user id");
  const previous = scopes.get(provider);
  if (previous && previous.context.userId !== context.userId) throw new Error("Provider belongs to another user");
  const base = previous?.base ?? provider;
  const wrapped = new Proxy(base, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  scopes.set(wrapped, { base, context: Object.freeze({ ...context }) });
  return wrapped;
}
export function getUsageContext(provider: LLMProvider): UserUsageContext | undefined {
  return scopes.get(provider)?.context;
}

export function resolveUsageContext(provider: LLMProvider, override?: UserUsageContext): UserUsageContext {
  const ambient = getLlmRequestContext() ?? {};
  if (ambient.userId !== undefined && override?.userId !== undefined && ambient.userId !== override.userId) throw new Error("Request belongs to another user");
  const fixed = getUsageContext(provider) ?? {};
  if (ambient.userId !== undefined && fixed.userId !== undefined && ambient.userId !== fixed.userId) throw new Error("Provider belongs to another user");
  const base = { ...ambient, ...fixed };
  if (base.userId !== undefined && override?.userId !== undefined && base.userId !== override.userId) throw new Error("Provider belongs to another user");
  const context = { userId: override?.userId ?? base.userId, personaId: override?.personaId ?? base.personaId, route: override?.route ?? base.route, purpose: override?.purpose ?? base.purpose };
  for (const value of [context.userId, context.personaId]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new Error("Invalid usage context");
  return context;
}

const requestContexts = new AsyncLocalStorage<UserUsageContext>();
export function getLlmRequestContext() { return requestContexts.getStore(); }
export function withLlmRequestContext<T>(context: UserUsageContext, callback: () => T): T {
  if (context.userId !== undefined && (!Number.isSafeInteger(context.userId) || context.userId < 1)) throw new Error("Invalid request user");
  return requestContexts.run(Object.freeze({ ...context }), callback);
}
