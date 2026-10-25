import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";

const STORAGE_KEY = "foreword_dismissed";

export default function ForewordModal() {
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setOpen(true);
    }
  }, []);

  function handleClose() {
    if (dontShowAgain) {
      localStorage.setItem(STORAGE_KEY, "1");
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent
        className="w-[min(92vw,720px)] max-w-none rounded-xl border-border bg-card p-0 gap-0 max-h-[86vh] flex flex-col overflow-hidden shadow-2xl"
      >
        <DialogHeader className="border-b border-border/60 px-5 py-4 text-left shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BookOpen className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold text-foreground">项目介绍</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                项目缘起。读完后默认不再自动弹出，可在需要时重新查看文档。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="h-0 flex-1 overflow-hidden">
          <div className="px-6 py-5 text-[0.9375rem] text-foreground/90 leading-7 space-y-5">
            <blockquote className="rounded-lg border-l-2 border-primary/50 bg-muted/30 px-4 py-3 text-muted-foreground text-sm leading-7">书中人是一个面向虚构角色与交互叙事的创作空间。</blockquote>

            <div className="h-px bg-border/60" />
            <p>一个故事可以从角色的一句话开始，也可以从一张尚未读懂的地图开始。</p>

            <p>角色的身份、表达方式、经历与边界，共同决定故事中的回应。</p>

            <p>这些资料由创作者选择和整理，不需要把真实人物当作默认模板。</p>

            <p>原创角色可以拥有清楚的目标，也可以保留尚未解释的疑问。</p>

            <p>故事因此有了继续展开的空间。</p>

            <div className="h-px bg-border/60" />

            <p>角色名字是进入故事的起点。</p>

            <p>身份说明帮助读者理解角色此刻正在做什么。</p>

            <p>性格不只是几组形容词，也体现为角色面对问题时的选择。</p>

            <p>说话风格则让同一个事实呈现出不同的语气。</p>

            <p>简短的回应可以很具体，完整的说明也可以保持自然。</p>

            <p>这些细节都可以逐步补充。</p>

            <div className="h-px bg-border/60" />
            <p>创作者不必一次写完全部背景。</p>

            <p>先确定一个场景，再让角色围绕眼前的问题交流。</p>

            <p>场景可以是一间档案馆，也可以是一座山间驿站。</p>

            <p>一张地图、一份目录或一段天气记录，都能成为行动的线索。</p>

            <p>不同角色可能对同一条线索作出不同判断。</p>

            <p>分歧也是故事的一部分。</p>

            <div className="h-px bg-border/60" />
            <p>已确认的事实应当与猜测分开。</p>

            <p>角色知道什么、相信什么，以及尚未知道什么，并不总是一回事。</p>

            <p>记录这些差别，可以让后续对话保持连贯。</p>

            <p>没有依据的情节不必立刻补成结论。</p>

            <p>留下一个问题，有时比增加一个答案更有意义。</p>

            <p>故事可以等待下一次核对。</p>

            <p>资料库可以收纳背景、经历与已经提供的文本片段。</p>
            <p>使用原著材料时，应尊重素材来源和相应的使用权限。</p>

            <p>没有提供的段落，不应被说成已经找到的原文。</p>

            <p>角色自己的判断，也不等于作者已经确认的设定。</p>

            <p>让来源和推断保持清楚，故事就更容易维护。</p>

            <p>这是整理材料时值得保留的习惯。</p>

            <p>界面中的不同分组，承担着不同的创作工作。</p>

            <p>核心分组记录身份、硬性事实和当前处境。</p>

            <p>性格分组记录价值观与处理分歧的方式。</p>

            <p>关系分组记录角色之间已经建立的联系与边界。</p>

            <div className="h-px bg-border/60" />
            <p>原著分组收纳背景材料和使用准则。</p>

            <p>说话与行为分组则帮助描绘日常表达和行动方式。</p>

            <p>这些分组彼此关联，也保留各自的侧重点。</p>

            <p>一个偏好不必变成不可改变的命令。</p>

            <p>一个过去的决定也不必预先决定所有未来选择。</p>

            <p>角色可以在故事里成长，但变化应当有可追踪的来由。</p>

            <p>同伴之间可以讨论，也可以暂时保留不同意见。</p>

            <p>创作者可以决定何时让情节继续。</p>
            <p>对话记录保留故事已经走过的路径。</p>

            <p>记忆整理关注关键事件、约定与角色偏好。</p>

            <p>日记可以提供另一种观察同一天故事的角度。<code className="text-xs bg-muted/50 px-1 py-0.5 rounded">这些材料不应彼此替代，也不需要写成同一种声音。</code>简洁的记录更容易在之后找到。</p>

            <p>完整的背景则可以保留在适合它的位置。</p>

            <div className="h-px bg-border/60" />

            <p>一个场景中的事实，不应悄悄成为另一个场景的前提。</p>

            <p>切换时代、地点或角色身份时，应重新检查相关设定。</p>

            <p>同样一句话，在不同情境里可能有不同含义。</p>

            <p>场景边界让故事拥有清楚的起点。</p>

            <p>明确的边界也方便创作者比较不同走向。</p>

            <p>每一种走向都可以独立展开。</p>
            <p>多角色场景提供了另一种观察方法。</p>

            <p>不同的表达习惯和行动目标，可以形成自然的交流。</p>

            <p>轮到谁说话、这一轮推进多少，都应有明确安排。</p>

            <p>用户的插话可以成为新的问题，也可以让人物停下来思考。</p>

            <p>故事不需要无休止地自动继续。</p>

            <div className="h-px bg-border/60" />

            <p>停顿同样是一种创作选择。</p>

            <p>界面中的搜索、筛选和排序，用来帮助找到已有材料。</p>

            <p>展开一段记录，是为了看清它的上下文。</p>
            <p>编辑一条设定，是为了表达更准确的创作意图。</p>

            <p>这些操作应当让材料更清楚，而不是掩盖不确定性。</p>

            <p>必要时，可以回到最初的问题。</p>

            <p>从一个可以确认的细节重新开始。</p>

            <p>角色的情绪可以影响表达，但不必取代事实。</p>

            <p>温柔、好奇、低落或轻松，都可以有具体的场景依据。</p>

            <p>不需要用夸张的描述填满每一次回应。</p>

            <div className="h-px bg-border/60" />
            <p>一个清楚的动作，往往足以推进当前一拍。</p>

            <p>一件普通的道具，也可以连接前后的情节。</p>

            <p>故事的节奏由创作者共同决定。</p>

            <p>书中人的名字，指向文字中的角色与人与故事的连接。</p>

            <p>Ink & Kin 延续同一个创作主题。</p>

            <p>Where ink becomes kin.</p>

            <div className="h-px bg-border/60" />

            <p>与书中人相识，让故事继续。</p>

            <p>这段介绍只提供一个理解创作界面的入口。</p>

            <p>实际故事由每位创作者自己的材料与选择组成。</p>

            <p>你可以先写下一个虚构角色的名字。</p>

            <p>然后给这个角色一个具体的地点与目标。</p>

            <p className="text-right text-muted-foreground text-xs mt-2">再问一个能够继续讨论的问题。</p>
          </div>
        </ScrollArea>

        <div className="border-t border-border/60 bg-card px-5 py-4 space-y-4 shrink-0">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <Checkbox
              checked={dontShowAgain}
              onCheckedChange={(v) => setDontShowAgain(v === true)}
            />
            <span className="text-sm text-muted-foreground">下次不再弹出</span>
          </label>
          <Button className="w-full rounded-xl" onClick={handleClose}>
            我已阅读
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
