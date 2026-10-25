import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowLeft, Upload as UploadIcon, FileText, Image as ImageIcon, Video as VideoIcon,
  CheckCircle2, Loader2, Sparkles, AlertCircle, ChevronRight, Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const FILE_TYPE_ICONS: Record<string, any> = {
  chat_txt: FileText, chat_csv: FileText, image: ImageIcon, video: VideoIcon,
};

const ALL_ACCEPT = ".txt,.csv,image/*,video/*";
const SOURCE_ACCEPT = ".txt,.md,.markdown,.epub";
const SOURCE_EXTENSIONS = new Set(["txt", "md", "markdown", "epub"]);
const SOURCE_MAX_BYTES = 20 * 1024 * 1024;
type MaterialCategory = "persona" | "source";
type UploadDetail = { fileName: string; personaId: number; category: MaterialCategory; error?: string };

function detectFileType(file: File): "chat_txt" | "chat_csv" | "image" | "video" {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "txt") return "chat_txt";
  if (ext === "csv") return "chat_csv";
  if (file.type.startsWith("video/")) return "video";
  return "image";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getMimeType(file: File, fileType: string): string {
  if (fileType === "chat_txt") return "text/plain";
  if (fileType === "chat_csv") return "text/csv";
  return file.type || "application/octet-stream";
}

export default function Upload() {
  const params = useParams<{ id: string }>();
  const personaId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const [materialCategory, setMaterialCategory] = useState<MaterialCategory>("persona");
  const [uploadingFiles, setUploadingFiles] = useState<Record<string, "uploading" | "done" | "error">>({});
  const [uploadDetails, setUploadDetails] = useState<Record<string, UploadDetail>>({});
  const [sourceDeleteErrors, setSourceDeleteErrors] = useState<Record<number, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadSequenceRef = useRef(0);

  const { data: persona, refetch: refetchPersona } = trpc.persona.get.useQuery(
    { id: personaId }, { enabled: isAuthenticated && personaId > 0 }
  );
  const { data: files, refetch: refetchFiles } = trpc.file.list.useQuery(
    { personaId }, { enabled: isAuthenticated && personaId > 0 }
  );
  const sourceDocuments = trpc.sourceLibrary.list.useQuery(
    { personaId }, { enabled: isAuthenticated && personaId > 0 && materialCategory === "source" }
  );
  const { data: analysisStatus, refetch: refetchStatus } = trpc.persona.getAnalysisStatus.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && personaId > 0,
      refetchInterval: (query) => query.state.data?.status === "analyzing" ? 1500 : false }
  );

  useEffect(() => {
    if (analysisStatus?.status === "ready") refetchPersona();
  }, [analysisStatus?.status]);

  const uploadMutation = trpc.file.upload.useMutation({
    onError: (e) => toast.error("上传失败：" + e.message),
  });
  const triggerMutation = trpc.persona.triggerAnalysis.useMutation({
    onSuccess: () => { toast.success("AI 解析已开始"); refetchStatus(); },
    onError: (e) => toast.error("解析失败：" + e.message),
  });
  const refreshSourceLibrary = useCallback(async () => {
    const results = await Promise.allSettled([
      sourceDocuments.refetch(),
      utils.sourceLibrary.overview.invalidate({ personaId }),
    ]);
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") {
      toast.error("原文资料已更新，但刷新失败，请点击刷新重试。" + (failed.reason instanceof Error ? failed.reason.message : ""));
    }
  }, [sourceDocuments.refetch, utils, personaId]);
  const sourceUploadMutation = trpc.sourceLibrary.upload.useMutation();
  const sourceDeleteMutation = trpc.sourceLibrary.delete.useMutation({
    onSuccess: async (_result, variables) => {
      setSourceDeleteErrors(prev => ({ ...prev, [variables.documentId]: "" }));
      toast.success("原文资料已删除");
      await refreshSourceLibrary();
    },
    onError: (error, variables) => {
      setSourceDeleteErrors(prev => ({ ...prev, [variables.documentId]: error.message }));
      toast.error("删除失败：" + error.message);
    },
  });

  const handleFiles = useCallback(async (fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      const key = `${materialCategory}-${file.name}-${Date.now()}-${uploadSequenceRef.current++}`;
      setUploadDetails(prev => ({ ...prev, [key]: { fileName: file.name, personaId, category: materialCategory } }));
      setUploadingFiles(prev => ({ ...prev, [key]: "uploading" }));
      try {
        if (materialCategory === "source") {
          const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
          if (!SOURCE_EXTENSIONS.has(extension)) throw new Error("原文资料仅支持 .txt、.md、.markdown 和 .epub 文件。");
          if (file.size === 0) throw new Error("原文文件为空，请选择有内容的文件。");
          if (file.size > SOURCE_MAX_BYTES) throw new Error("原文文件不能超过 20 MiB。");
          const content = await fileToBase64(file);
          await sourceUploadMutation.mutateAsync({ personaId, fileName: file.name, fileContent: content });
          setUploadingFiles(prev => ({ ...prev, [key]: "done" }));
          toast.success(`${file.name} 原文资料已导入`);
          await refreshSourceLibrary();
          continue;
        }
        const fileType = detectFileType(file);
        const content = await fileToBase64(file);
        await uploadMutation.mutateAsync({
          personaId, fileName: file.name, fileType,
          fileSize: file.size, fileContent: content, mimeType: getMimeType(file, fileType),
        });
        setUploadingFiles(prev => ({ ...prev, [key]: "done" }));
        toast.success(`${file.name} 上传成功`);
        refetchFiles();
      } catch (error) {
        const message = error instanceof Error ? error.message : "文件处理失败，请重试。";
        setUploadingFiles(prev => ({ ...prev, [key]: "error" }));
        setUploadDetails(prev => ({ ...prev, [key]: { fileName: file.name, personaId, category: materialCategory, error: message } }));
        if (materialCategory === "source") toast.error(`${file.name}：${message}`);
      }
    }
  }, [personaId, materialCategory, uploadMutation, refetchFiles, sourceUploadMutation, refreshSourceLibrary]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const isAnalyzing = analysisStatus?.status === "analyzing";
  const isReady = analysisStatus?.status === "ready";
  const hasFiles = (files?.length || 0) > 0;
  const visibleUploads = Object.entries(uploadingFiles).filter(([key]) => uploadDetails[key]?.personaId === personaId && uploadDetails[key]?.category === materialCategory);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <button onClick={() => navigate("/")}
            className="app-nav-back -ml-1 gap-1">
            <ArrowLeft className="w-4 h-4" /><span className="text-sm">返回</span>
          </button>
          <div className="app-nav-divider" />
          <div className="app-nav-title-group">
            <div>
              <p className="app-nav-title">{persona?.name || "..."}</p>
              <p className="app-nav-subtitle">上传资料</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-2xl mx-auto">
        <div className="warm-card p-1.5 mb-5 flex gap-1.5" role="group" aria-label="资料分类">
          <Button type="button" variant={materialCategory === "persona" ? "default" : "ghost"}
            aria-pressed={materialCategory === "persona"} onClick={() => { setMaterialCategory("persona"); setDragOver(false); }}
            className="flex-1 rounded-xl text-sm">角色分析材料</Button>
          <Button type="button" variant={materialCategory === "source" ? "default" : "ghost"}
            aria-pressed={materialCategory === "source"} onClick={() => { setMaterialCategory("source"); setDragOver(false); }}
            className="flex-1 rounded-xl text-sm">原文资料</Button>
        </div>
        {/* Analysis Status */}
        {materialCategory === "persona" && (isReady ? (
          <div className="warm-card p-5 mb-6 flex items-center justify-between animate-fade-in-up">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              <div>
                <p className="text-foreground font-medium">角色已准备好</p>
                <p className="text-muted-foreground text-sm">{analysisStatus?.message}</p>
              </div>
            </div>
            <Button onClick={() => navigate(`/chat/${personaId}`)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl">
              开始对话 <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        ) : isAnalyzing ? (
          <div className="warm-card p-5 mb-6 animate-fade-in-up">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
              <p className="text-foreground font-medium">AI 正在解析中...</p>
            </div>
            <p className="text-muted-foreground text-sm mb-3">{analysisStatus?.message}</p>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="progress-bar h-full" style={{ width: `${analysisStatus?.progress || 0}%` }} />
            </div>
            <p className="text-right text-xs text-muted-foreground mt-1">{analysisStatus?.progress || 0}%</p>
          </div>
        ) : analysisStatus?.status === "error" ? (
          <div className="warm-card p-5 mb-6 border-destructive/20 animate-fade-in-up">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-destructive" />
              <p className="text-muted-foreground text-sm">{analysisStatus?.message || "解析失败，请重试"}</p>
            </div>
          </div>
        ) : null)}

        {materialCategory === "source" && (
          <div className="warm-card p-5 mb-6 animate-fade-in-up">
            <p className="text-foreground font-medium mb-2">原文资料用于检索</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              保存规范化后的原文并分块检索，不触发角色蒸馏。EPUB 会提取正文，不提供原始 EPUB 文件下载。
              检索到的原文片段会随对话请求发送给你配置的模型服务，请仅上传你有权使用的资料。
            </p>
          </div>
        )}

        {/* Drop Zone */}
        <div
          className={`warm-card p-8 mb-5 text-center border-2 border-dashed transition-all cursor-pointer animate-fade-in-up ${
            dragOver ? "border-primary/60 bg-primary/5" : "border-border hover:border-primary/30"
          }`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon className={`w-10 h-10 mx-auto mb-3 transition-colors ${dragOver ? "text-primary" : "text-muted-foreground/30"}`} />
          <p className="text-foreground/70 font-medium mb-1">拖拽文件到这里，或点击选择</p>
          <p className="text-muted-foreground text-sm">{materialCategory === "source" ? "支持 .txt、.md、.markdown、.epub，单个文件不超过 20 MiB" : "支持 .txt、.csv、图片、视频"}</p>
          <input key={materialCategory} ref={fileInputRef} type="file" accept={materialCategory === "source" ? SOURCE_ACCEPT : ALL_ACCEPT}
            multiple className="hidden" onChange={e => { if (e.target.files) void handleFiles(e.target.files); e.currentTarget.value = ""; }} />
        </div>

        {/* Uploaded Files */}
        {materialCategory === "persona" && hasFiles && (
          <div className="warm-card p-5 mb-5 animate-fade-in-up">
            <p className="text-foreground/70 text-sm font-medium mb-3">已上传文件 ({files?.length})</p>
            <div className="space-y-2">
              {files?.map((f: any) => {
                const Icon = FILE_TYPE_ICONS[f.fileType] || FileText;
                return (
                  <div key={f.id} className="flex items-center gap-3 py-2 px-3 bg-muted/30 rounded-lg">
                    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm text-foreground/70 flex-1 truncate">{f.originalName}</span>
                    <span className="text-xs text-muted-foreground">{(f.fileSize / 1024).toFixed(0)} KB</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {materialCategory === "source" && (
          <div className="warm-card p-5 mb-5 animate-fade-in-up">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-foreground/70 text-sm font-medium">原文资料 ({sourceDocuments.data?.length ?? 0})</p>
              <Button type="button" size="sm" variant="ghost" className="rounded-xl text-xs" disabled={sourceDocuments.isFetching}
                onClick={() => void sourceDocuments.refetch()}>刷新</Button>
            </div>
            {sourceDocuments.isPending ? (
              <p role="status" className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />正在读取原文资料...</p>
            ) : sourceDocuments.isError ? (
              <p role="alert" className="text-sm text-destructive">{sourceDocuments.error.message}</p>
            ) : sourceDocuments.data?.length ? (
              <div className="space-y-2">
                {sourceDocuments.data.map(document => (
                  <div key={document.id} className="py-2 px-3 bg-muted/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground/70 truncate" title={document.title}>{document.title}</p>
                        <p className="text-xs text-muted-foreground truncate" title={document.fileName}>{document.fileName}</p>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{(document.byteSize / 1024).toFixed(0)} KB · {document.chunkCount} 块</span>
                      <Button type="button" size="sm" variant="ghost" disabled={sourceDeleteMutation.isPending}
                        aria-label={`删除原文资料 ${document.title}`} className="rounded-lg px-2 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (!window.confirm(`删除原文资料“${document.title}”？相关检索片段也会删除，此操作无法撤销。`)) return;
                          setSourceDeleteErrors(prev => ({ ...prev, [document.id]: "" }));
                          sourceDeleteMutation.mutate({ personaId, documentId: document.id });
                        }}>
                        {sourceDeleteMutation.isPending && sourceDeleteMutation.variables?.documentId === document.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </Button>
                    </div>
                    {sourceDeleteErrors[document.id] && <p role="alert" className="mt-2 text-xs text-destructive break-words">{sourceDeleteErrors[document.id]}</p>}
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">暂无原文资料，可在上方选择文件导入。</p>}
          </div>
        )}

        {/* Uploading */}
        {visibleUploads.length > 0 && (
          <div className="warm-card p-4 mb-5 animate-fade-in">
            <div className="space-y-3">
              {visibleUploads.map(([key, status]) => (
                <div key={key}>
                  <div className="flex items-center gap-2 text-sm">
                    {status === "uploading" ? <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" /> : status === "done" ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />}
                    <span className="flex-1 truncate text-foreground/70" title={uploadDetails[key]?.fileName}>{uploadDetails[key]?.fileName}</span>
                    <span className="text-xs text-muted-foreground">{status === "uploading" ? "上传中..." : status === "done" ? "上传成功" : "上传失败"}</span>
                  </div>
                  {uploadDetails[key]?.error && <p role="alert" className="mt-1 text-xs text-destructive break-words">{uploadDetails[key].error}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trigger Analysis */}
        {materialCategory === "persona" && hasFiles && !isAnalyzing && !isReady && (
          <Button className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground text-base font-semibold rounded-xl animate-fade-in-up"
            onClick={() => triggerMutation.mutate({ id: personaId })} disabled={triggerMutation.isPending}>
            {triggerMutation.isPending
              ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />启动中...</>
              : <><Sparkles className="w-5 h-5 mr-2" />开始 AI 解析，生成角色</>}
          </Button>
        )}

        {/* Tips */}
        <div className="mt-6 p-4 bg-muted/30 rounded-xl border border-border animate-fade-in-up">
          <p className="text-foreground/50 text-xs font-medium mb-2">{materialCategory === "source" ? "原文资料说明" : "上传建议"}</p>
          <ul className="text-muted-foreground text-xs space-y-1 leading-relaxed">
            {materialCategory === "source" ? <>
              <li>· 支持 UTF-8 文本、Markdown 和 EPUB，单个文件不超过 20 MiB。</li>
              <li>· 保存用于检索的规范化正文，不提供原始 EPUB 下载。</li>
              <li>· 原文资料不会触发角色蒸馏；检索片段可能发送给所配置的模型服务。</li>
            </> : <>
            <li>· 微信聊天记录：在微信 → 聊天详情 → 导出聊天记录 → 保存为 txt</li>
            <li>· 聊天记录越多，AI 分析越准确（建议至少 100 条消息）</li>
            <li>· 可以同时上传多种类型的文件，AI 会综合分析</li>
            <li>· 角色分析材料会交由所配置的模型服务处理，请仅上传你有权使用的资料。</li>
            </>}
          </ul>
        </div>
      </main>
    </div>
  );
}
