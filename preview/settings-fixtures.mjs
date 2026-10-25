// 仅供界面预览：静态读取数据，不访问服务、凭据、文件系统或生产配置。
// 返回的是查询data；HTTP/tRPC包装由预览入口负责。所有mutation路径均返回undefined。
const providers = [
  { name: "DeepSeek", configured: true, supportsModelList: true, supportsReasoningEffort: true,
    baseUrl: "https://deepseek-primary.example.test/v1", model: "deepseek-chat", reasoningEffort: null, dynamicRouting: true,
    relays: [
      { id: 101, relayName: "DeepSeek 示例主站", priority: 120, enabled: true, baseUrl: "https://deepseek-primary.example.test/v1", model: "deepseek-chat", reasoningEffort: null, apiKeyConfigured: true },
      { id: 102, relayName: "DeepSeek 示例备用站", priority: 100, enabled: true, baseUrl: "https://deepseek-backup.example.test/v1", model: "deepseek-chat", reasoningEffort: "low", apiKeyConfigured: true },
    ] },
  { name: "OpenAI", configured: true, supportsModelList: true, supportsReasoningEffort: true,
    baseUrl: "https://openai-preview.example.test/v1", model: "gpt-4o-mini", reasoningEffort: "medium", dynamicRouting: false,
    relays: [{ id: 201, relayName: "OpenAI 示例站", priority: 110, enabled: true, baseUrl: "https://openai-preview.example.test/v1", model: "gpt-4o-mini", reasoningEffort: null, apiKeyConfigured: true }] },
  ...["Claude", "Gemini", "Grok", "Kimi", "Qwen", "Doubao", "302AI", "Atlas", "CheaperInference", "Ollama", "xunfei", "dify"].map(name => ({
    name, configured: false, supportsModelList: !["Ollama", "xunfei", "dify"].includes(name),
    supportsReasoningEffort: ["Claude", "Gemini", "Grok", "Kimi", "Qwen", "Doubao", "302AI", "Atlas", "CheaperInference"].includes(name),
    baseUrl: null, model: null, reasoningEffort: null, dynamicRouting: false, relays: [],
  })),
];
const fixtures = {
  "llmConfig.listProviders": providers,
  "llmConfig.getDefault": {
    id: 501, providerName: "DeepSeek", fallbackProvider: "OpenAI", isDefault: true, previewOnly: true,
    extraConfig: { temperature: 0.7, maxTokens: 4096, contextLimit: 20 },
  },
  "sceneImageConfig.get": {
    previewOnly: true, source: "none", hasSavedConfig: false, enabled: false, priorityStrategy: "comfyui_first",
    comfyPromptTemplate: null, apiKeyConfigured: false, baseUrl: "", model: "", size: "1024x1024", timeoutMs: 120000,
    cooldownMinutes: 10, maxPerHour: 6, relays: [], userReference: null, personaReferences: [], activePersonaReferenceKey: null,
    promptRewriteRelayId: null, promptRewriteDefaultRelayId: null, promptRewriteRelayOptions: [], environmentReferenceAvailable: false,
  },
  "qq.getStatus": {
    previewOnly: true, previewUnavailable: true, enabled: false, status: "disconnected", configured: false,
    baseUrl: null, loggedInUser: null, webhookSecretConfigured: false, lastError: null,
    message: "此界面预览未连接QQ服务，不会启动服务或打开真实登录窗口。",
  },
  "qq.recentContacts": [],
  "qq.listBindings": [],
  "system.operationsDiagnostics": {
    previewOnly: true, previewUnavailable: true,
    message: "界面预览未接运行诊断后台，没有读取进程、数据库、QQ、模型用量或本机目录。原诊断页面与交互入口保留，等待后续独立接线。",
  },
  "system.llmUsageDetails": { previewOnly: true, previewUnavailable: true, source: "preview_unavailable", records: [], summary: null },
  "system.sceneImageLogDetails": { previewOnly: true, previewUnavailable: true, records: [], summary: null },
};
export function settingsFixture(path, input) {
  if (!Object.hasOwn(fixtures, path)) return undefined;
  // 每次返回独立JSON数据，表单编辑不能修改下一次读取的预览样本。
  return JSON.parse(JSON.stringify(fixtures[path]));
}
