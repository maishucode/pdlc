# Atlas PDLC V2 稳定性重构完整方案

状态：设计提案，尚未实现。编写日期：2026-09-05。

目标是在现有 `Flow → Stage → Discipline → Runner → Adapter` 架构内，补齐可恢复执行协议。让进程中断、新会话接手、普通模型接手和多种 Flow，都依靠相同的持久化事实继续工作。

**核心决定：Runner 负责恢复、文件版本、执行状态与下一步；模型负责当前范围内的专业工作。** 保留现有概念和文件式存储，按小批次修改契约与实现。

本文是一份可独立阅读的完整方案。新增字段、命令、接口、目录与数值验收目标均属于拟议设计，不表示当前已实现能力或已测性能。历史审计事实与待实施契约分别标注；实施前必须核对目标分支的实际代码状态。

## 目录

| 部分 | 内容 |
|---|---|
| [一、目标与架构边界](#overview) | [历史基线](#baseline)、[恢复保证](#continuity)、[架构](#architecture)、[运行协议](#protocol-overview)、[共同约束](#invariants) |
| [二、运行恢复协议](#runtime-recovery) | [执行身份](#execution-state)、[锁](#writer-lock)、[事务](#journal)、[故障矩阵](#crash-matrix)、[幂等](#idempotency)、[文件恢复](#file-recovery)、[worker](#worker-recovery)、[resume 算法](#resume-algorithm)、[存储与备份](#retention)、[恢复验收](#recovery-tests) |
| [三、Flow、Stage 与 Discipline](#flow-stage-discipline) | [职责](#ownership)、[业务选择](#flow-planning)、[多 Flow](#flow-models)、[适用条件](#applicability)、[失效传播](#invalidation)、[跨 Flow 合同](#handoff)、[并行整合](#workspace-scale)、[规模验证](#scale-tests)、[修改边界](#flow-changes) |
| [四、普通模型与 Agent 协议](#agent-protocol) | [单一下一动作](#next-action)、[输入输出合同](#agent-contract)、[共享 Skill](#shared-skill)、[重试与暂停](#retry-boundaries)、[平台要求](#platform-support) |
| [五、实施、验收与迁移](#rollout) | [六批 PR](#implementation-plan)、[真实会话验收](#session-tests)、[迁移与回滚](#migration) |

<a id="overview"></a>

## 一、目标与架构边界


<a id="baseline"></a>

### 1.1 历史审计基线与待解决问题

历史审计使用 `feature/v2-stage-agent-runtime@e17cc3f` 与 `v2@bc83ce9` 两个固定提交。这两个 SHA 只表示已检查的历史快照，不代表目标分支的最新提交，也不意味着二者已经合并。按这两个快照观察，后者增加维护文档，未包含前者的 Stage Agent capability 变更。

本文中“现有”“当前”的代码事实和源码落点均指上述历史审计基线；它们用于定位设计缺口，实施前仍须复核目标提交。历史 V2 Runner 位于 `.pdlc/cli.ts`，不要照旧版目录结构中的 `pdlc/cli.ts` 路径实施。

历史审计中，`e17cc3f` 原有 75 项测试通过，`bc83ce9` 原有 71 项测试通过；这些结果不覆盖当前最新提交，也不验证本文新增能力。该次专项诊断仍复现以下缺口：

| 历史审计事实 | 重构后的可验收行为 |
|---|---|
| 需求变化但分类标签不变时，Stage 的上下文哈希和调用身份可能不变 | 实际输入版本进入执行身份；变更使受影响结果失效 |
| 输出文件被替换后，普通 evidence 校验仍通过 | 验证输出内容，并保存可恢复来源 |
| Record 写完而 Audit 未写时进程退出，留下不一致和残留锁 | 下次恢复完成同一笔已准备事务，自动获得已释放的进程锁 |
| 同一 receipt 重试增加 revision 和 event | 同一操作返回原结果，状态不重复推进 |
| 当前 Stage 根据字段和 receipt 推断 | 持久化 Stage 运行事实，Runner 确定下一步 |
| Hook 的适用条件未完整复用 Policy / Knowledge 的规则 | 所有贡献按同一交付上下文匹配，输出可解释的命中原因 |

<a id="continuity"></a>

### 1.2 “中断后可以继续”的准确含义

在已验收的平台、本地可写存储、保存的输入仍可取得的条件下，进程退出、响应丢失、半次受控写入、可隔离重试的本地 worker 等技术故障，应由下一次 `resume` 自动修复。用户不需要手工删锁、改 JSON 或重新描述已保存的需求。

没有常驻进程时，已退出的进程不会自行执行代码。恢复触发来自现有宿主的重新启动、打开交付会话、用户续做消息或已有重试机制：入口统一调用 `resume`。本方案不为此增加守护服务。

需要审批、业务答案、用户文件冲突处理或未知外部副作用核对时，返回具体所需动作和责任方；这些等待保留其业务含义。系统不把可恢复的技术问题永久保存成一个无法退出的 `blocked` 状态。

恢复指从最近一次持久化边界继续。未保存的编辑、模型内部状态和未提交的中间结论不能凭空恢复。流程连续性与专业工作质量分别验收，不承诺任意模型都能完成任意专业任务。

恢复保证分成三项分别验收：

1. **执行恢复：** 知道哪个 Record、哪个 Stage、哪次 attempt 以及合法下一步。
2. **文件恢复：** 从被绑定的来源取得相同字节，校验内容哈希，再交给 worker。
3. **工作续做：** 使用已保存的有效产物、检查结果和简短事实交接继续；不依赖旧聊天或模型内部思考。

普通模型支持按执行能力和实际样本验收，包含 Luna 类普通模型的接手场景。稳定的协议可以减少模型的调度负担，专业任务质量仍需正常测试与评审。

<a id="architecture"></a>

### 1.3 架构边界

```text
                  SHARED DEFINITIONS
       Flow -----> ordered canonical Stages
        |                   ^
        |             Discipline contributions
        |             Policies / Knowledge / Hooks
        v
                  EXISTING RUNNER
        resolve -> plan -> execute -> validate
           |                    |
           v                    v
    Record.execution       Platform Adapter
    inputs / attempts      at most one dispatch per attempt
    results / progress            |
           ^                      v
           +--- validated artifact references
           |
    short durable transaction
    Record + Audit + publication references
           |
    governed Checkpoint when required
```

| 边界 | 保持的职责 | 局部调整 |
|---|---|---|
| Flow | 顺序、条件 Stage、审批、角色和生命周期状态 | 描述各 Stage 的输入绑定与合法动作，复用通用恢复 |
| Stage | 工作目的、完成要求和产物类型 | 补足可执行的输入输出契约；不把每份文件变成新 Stage |
| Discipline | Policies、Knowledge、Skills、Agents、Hooks | 统一匹配逻辑与依赖清单；不直接修改受控状态 |
| Runner / Core | 调度、校验、状态与审计 | 统一事务入口、执行事实、幂等与恢复协议 |
| Adapter | 平台执行映射 | 捕获真实执行引用，声明查询、取消和隔离能力 |
| Workspace | 项目文件、交付历史和产物 | 保存运行输入输出的可恢复版本 |

当前 Flow 禁止重复引用同一个 Stage，首期用 `recordId + stageId + attempt` 标识一次执行即可。保持这个限制，无需提前新增 `nodeId`、通用 DAG、Job、Session 或调度集群。

`Record.status` 继续表示 Flow 的审批状态；新增 `Record.execution` 表示 Stage 工作进度。`Checkpoint` 仍是受控决策，操作性的进度保存不产生新的人工审批。

<a id="protocol-overview"></a>

### 1.4 统一运行协议

以下为拟新增的内部协议。交付用户通过自然语言操作，不需要执行命令。

```text
resume(recordId)
  -> recover prepared transaction
  -> reconcile active attempt and files
  -> resolve selected Stage context
  -> return exactly one nextAction

nextAction
  -> run_action / invoke_worker / wait / needs_input / needs_approval
  -> conflict / unsupported / done
```

沿用现有 `action` 分发入口增加保留的 runtime actions：`stage-start`、`stage-save`、`stage-result`。已有业务 `checkpoint`、`readiness` 和 Flow-owned actions 保持入口兼容；`status` 保持只读。Core 区分通用 runtime action 与 Flow-owned action，不增加按 Flow ID 写死的业务分支。

模型拿到一份当前任务合同：目标、必读文件、允许查阅的固定版本源码、适用贡献、可写范围、完成条件、上次有效进度。返回实际工作结果和产物引用。ID、哈希、时间戳、receipt 结构、事务和 Audit 由 Runner 管理；专业结论仍须有实际结果与证据。

拟议运行状态为 `pending | running | completed | interrupted | failed`。等待用户审批、可重试繁忙等由 `nextAction` 解释，不另造一套生命周期。

<a id="invariants"></a>

### 1.5 必须一起成立的设计决定

| 决定 | 对实现的约束 |
|---|---|
| 已 durable prepare 的事务向前恢复 | 不再混用“先追加 Audit、失败又回滚 Record”的不确定策略 |
| 单 workspace 的短事务串行化 | init、current pointer、Record、Audit 和 Stage 结果接纳走同一入口；模型工作与网络调用期间不持锁 |
| 文件哈希带恢复来源 | Git revision 或不可变对象必须保留可取回的字节；不能只记录路径、哈希或 dirty 状态 |
| 幂等身份由 Runner 生成并持久化 | 网络或调用重试复用操作 ID；真正重做才增加 attempt |
| worker 写入隔离且结果有 fencing | 旧 attempt 迟到结果不能覆盖当前结果；无法隔离时先确认旧 worker 退出 |
| 同一 attempt 的派发去重 | 持久化 dispatch claim 或使用平台幂等派发；重复 token 只查询已派发执行 |
| 只绑定实际输入与相关规则 | receipt、自增 revision、无关配置变化不能令运行失效；没有精细依赖时明确采用保守失效 |
| 单一批准版本 | 输入变更或跨 Flow rebase 不得悄悄延用过期审批，也不得覆盖旧批准产物 |
| 每次恢复提供一条明确下一步 | 模型不需要选择恢复版本、处理锁或推断业务状态机 |

进程锁保留 `withLock` 接口，替换易残留的排他创建文件实现为经过平台验收的 OS advisory lock；锁文件稳定存在，进程退出释放锁。它会引入一个很小的平台实现依赖，属于为正确性必要的局部变更。具体协议见[事务持久化](#journal)、[平台锁支持](#writer-lock)和[故障矩阵](#crash-matrix)。

<a id="runtime-recovery"></a>

## 二、运行恢复协议

本部分定义单 workspace 恢复、事务、文件版本与 worker 的共同运行契约。

<a id="execution-state"></a>

### 2.1 三条独立事实

| 事实 | 唯一归属 | 恢复时的处理 |
|---|---|---|
| 交付是否通过批准 | 现有 Record lifecycle 与 Flow checkpoint | 保留审批依据；恢复不批准、不撤销审批 |
| 当前 Stage 做到哪里 | 拟新增 `Record.execution` | 根据持久化运行记录继续，不由模型猜测 |
| 哪些文件构成本次输入与结果 | 本次运行的版本清单 | 校验内容，从确切来源重建运行目录 |

`checkpoint` 继续表示治理关口；本方案不新增另一种叫 checkpoint 的执行对象。Stage 与 Discipline 的关系见 [Flow、Stage 与 Discipline](#flow-stage-discipline)。

拟新增运行结构至少表达以下字段；最终 JSON Schema、TypeScript 类型与运行时校验必须一同落地：

```ts
type StageRun = {
  stageId: string;
  runKey: string;
  attempt: number;
  activeAttemptId?: string;
  status: "pending" | "running" | "completed" | "interrupted" | "failed";
  inputManifestRef: string;
  outputManifestRef?: string;
  platformExecutionRef?: string;
  progressRef?: string;
};
```

这些字段属于 `Record.execution`，不再增加 Session / Job / Task 状态机。`pending` 的 attempt 为 0，进入 `running` 时必须有正整数 attempt、active attempt ID 与完整输入清单。当前 Flow 中 Stage 引用唯一，暂不引入节点 ID；历史 attempt 的输入、结果与失败原因由不可变运行材料保留。

拟新增 `runKey = hash(recordId, flowVersion, stageId, contextHash, inputHash)`，绑定本次真实输入；`attemptId` 标识一次执行尝试。每个 Record/Stage 的 attempt 编号单调递增，输入变化也不重置，以免复用旧目录和身份。输入变化产生新的 `runKey`；同一输入重新执行产生新的 attempt；请求重传复用原 `operationId`。三者不能混用。

`inputHash` 只覆盖该 Stage 实际消费的字段和文件，不能包含整个 `record.revision`，否则运行会被自身写入进度的动作不断失效。

<a id="writer-lock"></a>

### 2.2 单机写入：先做一个可靠的边界

第一阶段维持每 workspace 一个 active Record、一个受控 writer。所有 Record 初始化、Record 更新、Audit 追加、current pointer 更新、运行结果接纳都进入同一个 workspace 短事务入口。

这也覆盖当前 `flow-engine.ts` 中直接 `writeRecord` 再 `audit.append` 的初始化路径。仅修改 `persistRecordAndAudit` 会遗漏第一次创建时的中断窗口。

保留 `withLock` 接口，替换其内部实现：

1. 使用 Runner 进程直接持有的 OS advisory lock；优先验收当前实际支持的平台与本地文件系统。
2. 锁文件使用稳定路径、稳定 inode，运行期间和恢复期间都不删除、不 rename。
3. 打开同一文件后取得排他锁；结束时关闭描述符；进程退出由内核释放锁。
4. PID、时间戳、token 仅用于诊断，不用于 TTL 夺锁或“检查以后 unlink”。
5. 不向 worker 继承锁描述符；不让可能比 Runner 活得更久的 helper 代持锁。

macOS / Linux 可使用经过实际验证的原生绑定或薄平台封装；Windows 需要对应适配和同等故障测试后才纳入保证。这里接受一项很小的平台依赖，不能用一个未经证明的 stale-lock 算法替代它。网络共享目录、跨主机共同写入暂不属于支持范围。

切换前必须确认旧版本 writer 已退出；新旧锁协议不能混用。旧 `.lock` 残留文件可以归档，但不能在旧 Runner 仍运行时仅忽略它们并启动新版 writer。

锁只覆盖恢复、版本检查和本地落盘，不跨模型调用、网络调用或用户审批。合并当前 `controlled-mutation`、`record`、`audit` 的嵌套锁，底层内部写入函数不重复取锁。

两个恢复者因此自然串行。活跃 writer 暂时持锁时，返回拟新增 `busy` 与 `retryAfterMs`，宿主稍后重试；不能把 Stage 永久写成 `blocked`。活进程被长期暂停与磁盘不可写是运行环境故障，不等于残留锁，不能靠强行删除锁“修复”。

<a id="journal"></a>

### 2.3 Journal 协议：准备完成后只向前提交

拟新增 journal 是文件存储的内部事务材料，不是新的业务实体。每次变更保存一个稳定 `operationId`；在受控写入前持久化完整的目标 Record、Audit event 与必要文件引用。

```ts
type PreparedMutation = {
  operationId: string;
  requestHash: string;
  recordId: string;
  beforeRecordHash: string | null;
  afterRecordHash: string;
  nextRecord: unknown;
  auditOffset: number;
  auditPrefixHash: string;
  auditEvent: unknown;
  nextCurrentRecordId?: string;
  result: unknown;
};
```

这是拟新增字段示意。实际实现还需包含 schema 版本与参与提交的材料哈希；`result` 是供重复请求返回的原操作结果，不应保存敏感凭据。

大对象准备在锁外完成：基于固定输入创建不可变候选文件，验证相同候选字节并同步到内容存储。输入来自可变目录时，先固定工作树/文件版本，不能把一边被修改一边复制的目录视为一致快照。已发布对象只读，准备失败最多留下无引用对象。

一次提交按固定顺序执行：

1. 取得 workspace 锁，完成已有 prepared journal 的恢复，再读取当前一致状态。
2. 查找 `operationId`：相同 `requestHash` 返回已保存结果；不同内容复用同一 ID 报精确冲突。
3. 校验 expected revision、输入版本、active attempt 和业务前置条件；此时失败不产生事务。
4. 核对锁外生成的候选清单、验证结果与当前绑定一致，且所引用对象已经持久化；不在锁内复制大文件或调用验证工具。
5. 写 journal 临时文件，`fsync(file)`，在同一文件系统内原子 rename 成 prepared，再同步父目录。
6. 按相同步骤替换 Record；Audit 使用 journal 已固定的 event ID、时间戳和精确字节追加并同步。
7. 如需切换 current pointer，按 journal 中的目标值原子替换；同步相关目录。
8. 写入并同步不可变 committed 操作回执，再删除 pending journal 并同步父目录；此后才向调用方确认成功并释放锁。回执已写而 pending 未删时，恢复核对原结果后完成清理。

**prepared 持久化以前可以放弃；prepared 持久化以后只能 roll-forward。** 不再执行“Record 已写但 Audit 出错就回滚 Record”的旧策略。磁盘暂时写入失败时保留 journal，下一次命令继续同一事务。

所有 Harness 一致性读取必须通过统一入口：普通执行和恢复命令先处理 journal；`status` 只取得同一短锁进行一致性读取，发现待恢复事务就报告 `recovery_required`，不修复或改写状态，也不把中间状态作为正常状态返回。底层裸文件读取不能被当作跨 Record / Audit 的事务快照。

Record、Audit、pointer 并非在文件系统上同时变化；对 Harness 使用者的一致性由短锁、prepared journal 和读取入口共同提供。绕过 Runner 直接打开这些文件时可能看见提交中间态，不能宣称多文件物理原子写入。

<a id="crash-matrix"></a>

### 2.4 每个中断窗口怎么处理

| 中断位置 | 下次恢复动作 | 可以确认的结果 |
|---|---|---|
| 获取锁前，或尚未形成 prepared | 清理无引用临时文件；按原操作 ID 重试 | 未提交，不增加 revision |
| 快照已经落盘，prepared 尚未发布 | 保留或回收无引用快照 | 不会出现 Record 引用不存在的对象 |
| prepared 已持久化，Record 尚未写 | 从 journal 写入精确目标 Record | 按已校验的操作继续提交 |
| Record 临时文件只写了一部分 | 丢弃临时文件，重新原子替换 | 正式 Record 保持完整 JSON |
| Record 已替换，Audit 尚未追加 | 验证目标哈希，补写原 Audit event | 不执行第二次业务变更 |
| Audit 尾行只写了一部分 | 验证尾部是预期 event 的前缀，修复该尾段 | 不留下半行，不重复事件 |
| Audit 完整，pointer 或 committed 回执未写 | 验证已存在 event，补齐剩余写入 | 同一操作只算一次 |
| committed 已持久化，响应丢失 | 从原操作记录返回原结果 | revision 与 Audit 数量均不增加 |
| 恢复过程中再被终止 | 再次执行相同恢复步骤 | 恢复本身也可重复 |
| 当前 Record 与 before / after 哈希都不符 | 输出具体文件、期望与实际哈希 | 不覆盖未知状态，需要修复冲突 |

Audit 恢复不能简单删除所有解析失败的末尾。journal 记录 append 前的字节边界与前缀校验；只有边界后的内容等于“预期 event 的完整字节或其前缀”时才能补齐。发现无关完整事件、前缀被修改或中间行损坏时，保留材料并报告完整性冲突。

Record 已处于目标哈希时跳过替换；Audit 已存在相同 event ID 且内容完全相同时跳过追加。相同 ID 内容不同是冲突。出现比 journal 更新的未知 Record 时不能降级覆盖；先核查该操作是否已有完整提交证据。

已有 rollback 测试应调整为新的提交语义：prepared 前失败不提交，prepared 后失败保存待恢复事务。必须新增子进程 `SIGKILL` 故障注入，不能只用可被 `catch` 捕获的异常模拟崩溃。

<a id="idempotency"></a>

### 2.5 幂等回执不能随着清理一起消失

宿主在第一次发送变更请求前保存拟新增 `operationId`，断线重传继续使用它。Runner 在 journal 中保存 ID、语义请求哈希、原 event ID 与返回结果。不要用模型临时编造的另一个 ID 判断是否重复。

提交完成后保留小型 committed 幂等回执，pending journal 可以清理；回执在 Record 可继续操作期间必须保留，默认随 Record 归档长期保留。不能清理后把迟到重试当作新操作。若未来定义保留期，过期 ID 必须返回 `operation_expired` 并要求核查，不能静默再执行。

Stage complete 的语义重试还需校验 `runKey + attemptId + outputManifestHash`；即使调用方丢失操作 ID，也不能把完全相同的完成结果再次记为新完成。重新生成结果应显式创建新 attempt。

目录按 Record 与 operation ID 直接定位，避免每次恢复扫描全部项目历史。不额外建立一套权威幂等数据库；索引可以丢失后从已保存回执重建。

<a id="file-recovery"></a>

### 2.6 输入、输出与工作目录的边界

拟新增每份受控文件的清单项：`logicalName + path + contentHash + source`。`source` 必须能取回相同字节，例如指定 Git commit 中的文件，或者已经保存的不可变快照。只有 path 或 SHA-256 不足以恢复。

代码基线使用明确 Git commit；本次消费的 dirty / untracked 文件补快照，记录删除状态与必要文件模式。需求、设计、测试结果等未入 Git 的必要材料同样保存快照。输入配置、Discipline 版本和其内容哈希也须绑定，不能恢复时悄悄使用最新版。

绑定旧版本保证可复现，不能免除新生效的强制规则。派发、接纳结果与 checkpoint 前检查当前已配置治理版本；出现新适用 mandatory Policy 时重新判定资格，生成新 context/runKey 并检查哪些进度仍可复用。机械事务恢复仍按已准备内容完成，历史审批保留；后续动作接受新规则检查，详细变更语义见[输入版本与失效传播](#invalidation)。

源码 `treeHash` 排除 Record、Audit、journal、receipt、runtime 快照和 staging 等控制材料。本 attempt 的输入源码固定，编辑与 `stage-save` 属于独立 output/progress overlay，不反向改写自己的 inputHash；确实消费的上游产物通过输入 manifest 显式绑定。恢复重建原输入加已接纳进度，下一 Stage 再消费本次输出树。用户对共享工作树的新修改另外比较并报告冲突。

Runner 先在 attempt 专属目录重建本次输入并验证哈希，再将具体文件清单交给 worker。只恢复本次运行需要的内容，不复制整个仓库；无法取得的大型依赖必须明确为外部前置条件。

worker 输出也写入 attempt 专属 staging。完成或保存进度时先冻结不可变候选快照，再在同一候选字节上验证契约、执行检查并绑定证据，最后把引用放入受控事务。不能先测试可变目录、再快照另一版本。这样 Record 中的 completed 结果永远指向已经存在且经过验证的版本材料。

工作区中的便利副本属于可重建的投影，不是恢复事实来源。缺失副本可以按清单重建；已有文件不同则生成恢复候选与 diff，绝不为了 resume 覆盖用户修改。多个工作文件不可能仅靠一次 Record rename 同时原子发布，因此不要把这个行为算进已完成的事务保证。

Implementation 的代码编辑如需自动重试，必须在 attempt 隔离工作目录或现有 Git worktree 中执行。合并回用户工作目录是有明确前置版本检查的后续步骤；发现用户并发修改就处理冲突。不存在“单凭 manifest 就安全覆盖任意仓库”的保证。

Stage `completed` 表示合同要求的不可变输出已通过验证，不自动表示已合入用户源码。Flow 的后续验证必须消费该输出树；若交付 gate 要求整合，则先完成显式整合并验证整合后的 treeHash，才能放行。`status` 分别显示产物已完成与待整合事实，不能让旧工作树的测试结果证明新产物有效。

<a id="worker-recovery"></a>

### 2.7 Worker 中断与未知结果

启动前先持久化 `running`、attempt ID、输入清单和启动意图，再调用 adapter；获得平台执行引用后立即保存。外部调用与本地 journal 无法组成一个原子事务，故必须处理“已启动但引用尚未保存”的窗口。

同一个 attempt 的重复派发也必须去重：宿主调用 adapter 前，通过同一事务入口领取持久化的一次性 dispatch claim，或使用平台保证的 attempt 幂等派发键。重复 `invoke_worker` token 只能查询原派发，不能再次启动 worker。claim 写完但调用前后退出都可能留下未知状态；能证明未执行时安全继续，否则按下表核查或新建隔离 attempt。每 attempt 至多一次逻辑派发，不能承诺每次 attempt 都恰好启动一个 worker。

拟新增恢复决策按如下顺序运行：

| 可观察情况 | 自动动作 |
|---|---|
| 本地已持久化、完整的结果包 | 校验输入与输出，再接纳同一 attempt |
| Adapter 能查到运行仍在继续 | 重新连接，返回等待 / 获取结果这一项下一步 |
| Adapter 能查到运行已经完成 | 获取并校验输出，然后事务性完成 |
| Adapter 无法查询，但执行只有隔离的本地效果 | 废弃旧 attempt 的发布资格，建立新 attempt 重试 |
| 旧 worker 可能仍写共享用户目录 | 先确认其退出或停止；不能并发开始新 writer |
| 可能发生外部写入，结果不可确定 | 使用外部幂等键或查询回执核查；不能盲目重放 |

自动重试隔离执行时，在锁内更新 `activeAttemptId`。旧 worker 即使迟到完成，提交时也会因 attempt 已过期而失去发布资格；旧输出保留为诊断材料。这个 fencing 检查必须位于接纳结果的受控入口，不能只写在 Agent 提示词里。

这里的“本地效果”必须满足“只写自己 attempt 的文件”，而不是仅看 `externalWrites: false`。如果 worker 能直接编辑共享仓库，或能绕过 staging 写全局缓存、启动后台服务，就还不满足安全重试条件。

具有外部写入的能力必须声明 retry 语义。支持提供方幂等键时，跨重试沿用同一个逻辑外部操作键；可查询时先查询；两者皆无时输出具体的 `external_effect_unknown` 与核查方法。这是需要事实确认的边界，不能伪装成机械性 `blocked`，也不能承诺外部效果 exactly-once。

<a id="resume-algorithm"></a>

### 2.8 Resume 是确定的算法，不是提示词

拟新增 CLI `resume` 先修复机械问题，再返回一个 `nextAction`；不能把当前 Skill 的 resume 意图说成已经存在的 Runner API。沿用 `action <id> --input`，拟新增共享 runtime actions `stage-start`、`stage-save`、`stage-result`，分别记录开始、已验证部分产物 / 进度、最终结果；现有 checkpoint / readiness 接口保持。

这些 action 属于保留的 runtime action namespace，不由每个 Flow 重复实现，也不在 Core 中增加按 Flow ID 判断的分支。`stage-save` 与最终结果采用相同的快照和事务规则，因此长任务可以从已接纳的部分产物继续。

```text
Acquire short lock -> Recover journal -> Read consistent Record
    -> Capture revision / attempt / input identity -> Release lock
    -> Verify / Restore immutable files; Inspect adapter
    -> Acquire short lock -> Compare captured identity
    -> Accept unchanged facts or replan -> Release lock
    -> Return exactly one nextAction
```

大文件重建、哈希验证、远程查询在锁外进行；重新取锁时以 expected revision、active attempt 和输入绑定作 compare-and-swap 检查。状态已变则丢弃过期决策并重新计划，不在锁内等待模型、网络或整棵源码校验。

下一步由 Runner 根据事实选择：继续执行、取回结果、等待仍运行的 worker、运行验证、进入已有审批或解决具体冲突。模型负责执行这个动作，不负责从 Audit 历史推断隐藏流程。

恢复包应包含 Record ID、Flow / Stage、active attempt、必读文件、已持久化完成项、一个下一步、输出目标和验收命令。progress 只保存简短事实和下一步，不保存模型内部推理；progress 丢失时从已提交子产物重新开始当前步骤。

普通模型遵循与强模型完全相同的协议。模型切换不会改变审批、输入版本或运行身份；某平台无法提供原 worker 的会话记忆，也能依靠文件与确定的下一步继续。模型能力不足属于执行质量问题，需要验证与明确错误，不应该表现为损坏 runtime 状态。具体 Agent 合同见 [Agent 执行合同](#agent-contract)。

同一错误重复出现要设置有界重试，返回具体失败步骤、证据和可执行修复动作；不能让模型无限 `resume`，也不能把所有异常都变成需要人工批准。

<a id="retention"></a>

### 2.9 哪些材料必须留下

| 材料 | 保留与携带要求 |
|---|---|
| Record、Audit、current pointer、输入 / 输出 manifest、必要不可变快照 | 是恢复所需交付材料；随项目 Git 追踪，或纳入明确的可携带归档 |
| prepared journal | 不能当缓存删除；导出或迁移前先恢复，恢复不了则连同引用对象一起保存 |
| committed 幂等回执、已接纳 attempt 结果 | 随 Record 保留并归档；不能只保存在聊天或当前进程内存 |
| Git 来源的输入 | 必须保留可取回的 commit 对象；只有字符串 SHA 而对象已丢失不算可恢复 |
| lock、临时文件、未被接纳的 staging、派生索引 | 本机材料；迁移时不依赖旧锁，临时内容按引用关系回收 |
| 平台 token、密钥、访问凭据 | 不进入 journal、Git 或恢复包；通过宿主已有安全凭据机制获得 |

默认布局复用现有 `pdlc/` 交付目录；以下是拟新增路径，全部相对于项目根目录，文件内引用也保持可迁移：

```text
pdlc/
  records/<recordId>.json
  audit/<recordId>.jsonl
  evidence/runtime/<recordId>/
    operations/<operationId>.json          # Durable idempotency receipts
    stages/<stageId>/attempt-<n>/          # Manifests, accepted progress and results
  artifacts/runtime/<recordId>/objects/<hash>
  .state/
    current                               # Existing controlled active-record pointer
    runner.lock                           # Stable local OS lock file
    pending-mutation.json                 # One durable pending transaction
    runtime/<recordId>/<stageId>/attempt-<n>/
      contract.json                       # Generated view
      result.json                         # Candidate result, frozen before acceptance
      staging/                            # Isolated candidate outputs
```

每 workspace 同时只有一笔 pending mutation，直接定位该文件恢复；完整幂等回执按 Record/operation 定位。初始化及 current pointer 变化也带目标 Record ID。已接纳结果另存于永久目录，派生合同、未接纳结果不能取代它。

不能因为 `.state` 被 Git 忽略就把 pending journal 当缓存删除。正常备份先恢复 pending；无法恢复时将 journal 和所引用材料一起保留为故障归档。永久目录必须随 Git 或显式归档携带；不要求每次 Stage 保存自动创建 Git commit。

Git 追踪与可携带归档解决迁移、备份，不能代替本机每次事务的持久化。导出先在短锁内恢复事务、冻结一致的 Record/Audit/pointer 快照与引用集合，再在锁外复制不可变对象；导出引用在结束前不得被回收。对本机断电的保证还需在支持平台验证 file / directory 同步语义；第一轮必测进程退出与 `SIGKILL`。

<a id="recovery-tests"></a>

### 2.10 必须通过的验收

1. 在[故障矩阵](#crash-matrix)每个持久化窗口杀死独立子进程，重新启动两次恢复者；只有一次提交，无残留互斥死锁。
2. 重复请求、响应丢失重传、恢复中再次崩溃，Record revision 与 event 数量保持正确。
3. 覆盖初始化、current pointer、Stage start、progress、complete 与 checkpoint；所有变更都走统一事务。
4. 模拟 PID reuse、空旧锁文件、两个恢复者和活 writer；不删除新锁，不把 BUSY 写成业务阻塞。
5. 删除必要文件后从确切来源重建，哈希一致；修改用户文件后产生冲突，不覆盖。
6. 旧 worker 迟到交付被 attempt 校验拒绝；隔离本地执行可重试；未知外部效果不会被重复执行。
   同一 attempt 的两个宿主重放派发 token 时，只能领取一次 dispatch claim；claim 后崩溃可被核查或安全替换。
7. 全新宿主会话只读取项目恢复材料，用普通模型按单一 `nextAction` 推进到原有验证 / 审批边界。
8. 迁移到新目录后不依赖旧绝对路径、旧 PID 或聊天记录；缺失凭据给出明确前置条件。

只有这些验收完成，才能承诺“受支持的单机环境中，下一次唤起能够越过机械性中断继续工作”。审批、真实内容冲突、来源永久丢失和无法判断的外部效果应被准确呈现，不能通过删除状态或跳过校验制造进展。

<a id="flow-stage-discipline"></a>

## 三、Flow、Stage 与 Discipline

不同 Flow 的业务状态可以不同；执行恢复、输入绑定和拒绝过期结果由同一套 runtime 处理。

<a id="ownership"></a>

### 3.1 沿用现有架构，补齐执行契约

| 概念 | 负责什么 | 谁验证其结果 |
| --- | --- | --- |
| `Delivery Flow` | Stage 顺序、条件激活、业务状态、审批点和交付限制 | Runner 与 Flow-owned validator |
| `Stage` | 稳定的工作语义、要求、输入和输出类型 | 通用运行校验与业务产物校验 |
| `Discipline` | Policies、Knowledge、Defaults、Skills、Agent instructions、Hooks | 通用 resolver 与 receipt validator |
| `Stage attempt` | 某次执行的输入绑定、进度、结果和执行引用 | 通用 runtime |
| `Checkpoint` | 针对指定版本完成审批或受控业务状态转换 | Runner、审批角色与 Flow 规则 |
| `Adapter` | 实际启动、查询、继续或重新启动 worker | 通用执行协议与平台能力校验 |

```text
Flow definition + Record business state
                |
                v
       Ordered Stage selection
                |
       Discipline applicability
                |
                v
     Bound inputs + Stage attempt
                |
        Adapter -> Worker
                |
                v
     Validate outputs -> Persist
                |
      Continue / Approval / Finish
```

`Record.status` 表达业务审批状态，`execution.stages[stageId]` 表达执行状态；两者不能相互推断。
`COMMITTED` 不表示每个前置 Stage 都有可恢复文件，`completed` 的 worker 结果也不等于 Product 已批准。
当前 `.pdlc/core/schema.ts` 明确禁止同一 Flow 重复引用同一 Stage，因此直接按 `stageId` 保存当前执行即可。
执行身份包含 `recordId + stageId + attempt`；重试编号与业务状态分开，不用 Stage 在数组中的序号标识执行。
未来确实需要同一 Flow 多次引用同一 canonical Stage 时，再单独提出 `nodeId` 迁移；本轮不引入。

<a id="flow-planning"></a>

### 3.2 Flow 负责业务选择，Runner 负责执行和恢复

保留 `stageSequence` 的线性模型，required Stage 始终进入计划，conditional Stage 由 activation tags 决定。
计划必须绑定所用 Flow 定义及 activation snapshot；重新进入会话时不能读取最新版配置后悄悄改变执行顺序。
风险或技术分类通过受控变更更新后，重新解析计划；新增必需 Stage 必须执行，原先的跳过结果不能沿用。

建议给 `DeliveryFlowExecutor` 增加一个窄的纯函数扩展点，名称暂定 `planNext`：

```ts
type FlowStep =
  | { kind: "run-stage"; stageId: string }
  | { kind: "approve"; stageId: string; checkpointId: string }
  | { kind: "wait"; reasonCode: string; requiredAction: string }
  | { kind: "complete" };
```

该函数说明业务上下一步是什么；通用 Runner 再校验前置结果、适用 Controls、执行权限和审批边界。
`FlowStep` 仅是 Flow 内部业务建议，不是给 Agent 的响应枚举。Runner 将它映射为[Agent 协议](#next-action)统一的 `nextAction`：`run-stage` 可能需要 `run_action`、`invoke_worker` 或等待，`approve` 映射为 `needs_approval`，`complete` 经校验后映射为 `done`。恢复与平台事实由 Core 补足，Flow 不直接给模型调度指令。
Flow 不得实现自己的锁、文件恢复、attempt 重试或 receipt 去重；这些继续由同一个 runtime 处理。
`planNext` 返回 `approve` 也不能直接改变 Record，仍须执行现有受控 checkpoint 协议。

现有 `controls.checkpoints.contextStages` 只表示审批前需要哪些 context receipt，不表示这些 Stage 已完成。
必须将“上下文已应用”“工作产物已验证”“用户已批准”作为三个不同条件检查，避免把 receipt 当执行进度。
审批型 Stage 由 Runner 返回明确的审批动作；worker 不能生成一份 receipt 来宣告审批完成。
POC 中 `build-readiness` action 实际承担 Commit，需在 POC executor 内显式映射其与 `requirements-approval` 的关系。
在 `build-readiness` Stage 先完成只读就绪检查并提供可审查产物；到 `requirements-approval` 才在取得明确批准后调用现有 readiness 变更。不能让 Commit 提前于批准发生，也不能要求先有 COMMITTED 状态才能进入批准 Stage 而形成循环。
审批成功时，在同一受控事务中更新业务状态、审批记录和对应 Stage 状态，不移动 canonical Stage 的职责。

<a id="flow-models"></a>

### 3.3 三个 Flow 如何复用同一运行模型

| Flow | 当前代码状态 | 输入与输出 | Flow-owned 审批 |
| --- | --- | --- | --- |
| `poc` | active | 想法与 Requirements → 实现、验证证据、处置结果 | Commit、Verify、Decide |
| `product-requirements-analysis` | active | Requirements → versioned Stories、approved Sprint Scope | Requirements、Work Items、Scope、Change |
| `implementation` | planned | 拟议：已批准 Story/依赖合同 → 代码、测试、发布与运行验证证据 | 拟议：Build、Acceptance、Release、Outcome |

POC 与 requirements analysis 首先接入同一 `execution` 和 resume 协议，用两个真实 Flow 证明 Core 不再依赖 POC。
新增一个 Flow 应主要增加 Flow 定义、产物绑定与业务校验；不应继续修改 CLI 分发、事务恢复或 resume 算法。
现有 requirements analysis 类型引用 `PocDeliveryRecord`，且导入 `core/poc-progress.ts` 的 `contextTags`。
将这些真正共享的 context 字段和 tag 计算抽成小型共享类型/函数；POC 进度和处置规则移回 POC 目录。

技术恢复不自动重新开启业务终态。现有 POC 的 `PARKED` 是终态，没有 reopen action；`resume` 应修复未完成事务后返回 `done` 并解释终态。继续新的工作时建立关联旧版本产物的新 Record，或以后由该 Flow 明确定义 reopen 规则，不能靠修改 status 让它恢复运行。

下面是 implementation 的拟议输入合同与执行计划，**不是当前已经能运行的功能**：

```text
Approved upstream contract
  - source revision + selected Stories + dependency closure
  - artifact manifest + approval bindings
                    |
                    v
Requirements analysis / Acceptance criteria / Boundaries / Risk
  -> Solution design -> Conditional UX -> Test strategy
  -> Delivery planning -> Build readiness + Approval
  -> Implementation -> Developer / Conditional security verification
  -> Test preparation -> Test execution -> Acceptance
  -> Release readiness + Release approval
  -> Deployment -> Production validation -> Outcome
```

已批准的上游 Requirements 不必重新撰写，但需验证其版本、适用性和输入绑定后才可复用。
代码输出用 source manifest 表达，测试输出包含执行条件与证据 hash；发布输出还需要真实外部执行引用。
Flow gate 必须绑定它实际评审的代码和产物版本，不能拿旧 approval 放行重做后的产物。
现有 implementation 还缺 executable controls、完整 executor 与外部集成，保持 `planned`，不得仅改状态就宣称支持发布。
第一步使用 `implementation-local` 测试 fixture，明确范围为已批准合同 → 本地实现 → 验证 → 本地交付，终态仅代表本地代码与证据已验收。它用于证明通用 runtime，不作为正式 implementation 的发布能力。正式 Flow 继续保持 `planned`；若之后需要对用户开放本地 Flow，再单独声明其范围、审批和终态，不能静默跳过现有 required release Stage。

<a id="applicability"></a>

### 3.4 Discipline 必须使用一致的 applicability

现有 Policy/Knowledge resolver 已支持五维：`deliveryFlows`、`stages`、`riskTriggers`、`technologies`、`disciplines`。
五维之间是 AND，同一维中的候选值是 OR；缺省维不限制匹配，wildcard 的边界行为须由契约测试固定。
`effectiveApplicability` 按维继承 Discipline 默认；asset 明确声明的维覆盖默认维，不擅自改成集合交集。
每次解析使用同一份 Record activation snapshot，避免 Policy 看见新 risk、Hook 却使用旧 technology。

当前 Hook 是缺口：`resolveDisciplineGuidance` 只按 enabled、Flow 列表与 Stage 筛选，没有使用完整 applicability。
UX Discipline 默认只适用于 `web-ui/mobile-ui`，Policy/Knowledge 会继承这个限制，Hook 却不会。
因此 backend POC 也可能被要求执行 UX requirements/implementation worker；扩充 Hook 的 Flow 列表会扩散问题。

局部修改如下：

1. `resolveDisciplineGuidance` 接收与 Policy/Knowledge 相同的 resolution context。
2. 将 Hook 的 Flow 列表和 binding Stage 纳入匹配，继承 owning Discipline 的默认 applicability。
3. 特殊 Hook 确需更窄范围时才增加可选 `binding.appliesTo`，不引入新的 selector language。
4. 解析输出携带 `whyMatched` 和来源路径，能解释为什么装载、为什么未装载；不新增持久化业务实体。
5. 所有命中的 required capabilities 都进入通用执行协议；worker 只可选择声明的 candidate Skills。

Mandatory Policies 不能依赖模型随意选择 Discipline 才生效，Project Overlay 继续不能削弱 enterprise Controls。
新增 Flow 时必须检查 Policy 自身的 Flow 过滤条件：显式列举旧 Flow 的 Policy 不会自然覆盖新 Flow。
普遍适用的 Policy 应由其所有者明确声明通用范围；不得在 runtime 中猜测“所有新 Flow 自动适用”。

当前 Project Baseline schema 没有 `appliesTo`，resolver 会向每个 Stage 装入全部 baseline；这属于已知粗粒度行为。
先保留并记录其保守失效范围，再按 owning Discipline 的适用性和显式引用的 decision keys 迁移到精确装载。
迁移过程中缺少依赖声明就继续保守纳入；不能为减少上下文而漏掉 locked Control 所依赖的决策。

<a id="invalidation"></a>

### 3.5 输入版本、文件范围与失效传播

`contextHash` 继续证明执行规范版本；`inputHash` 另外绑定本次需求、产物和源文件，具体字段见恢复协议。
现有 `contextHash + stage` 不含具体需求内容，不能作为一次实际工作结果的完整身份。
命中资源的 hash 覆盖内容，不能只依赖文件名或手工版本号；所需 Skill 模板/脚本也应在显式资源清单中。

| 变化 | 预期处理 |
| --- | --- |
| 未命中的 Knowledge 或另一个 Flow 更新 | 不使当前 Stage 失效 |
| 当前治理版本新增或修改适用 mandatory Policy | 派发、结果接纳与 gate 前重新评估；旧绑定不提供豁免 |
| 命中的参考 Knowledge、Hook、Skill 更新 | 按固定版本复现，显式采用新版本时重新绑定，不静默混用 |
| 当前 Stage 消费的需求或产物内容更新 | 当前结果 stale，重新评估依赖它的后续结果 |
| 必需文件缺失但有有效恢复来源 | 恢复并重新校验，保留可复用结果 |
| 无来源或恢复内容不匹配 | 返回具体缺失对象与修复动作，不能拿另一版本冒充 |
| 仅聊天上下文丢失 | 从已绑定文件与进度恢复，不重新推断整个 Flow |

“当前治理版本”指项目已配置采用的 Harness/Overlay 版本，不是每次恢复自动下载任意远端最新版。恢复仍可修复已准备事务和读取历史；后续派发、接纳结果和审批要接受当前强制规则检查。新增适用强制规则产生新 context/runKey，保留旧 attempt 与审批历史并验证进度可复用性，不能在运行中的合同内悄悄换文件。

细粒度失效只对**已经声明并验证的输入依赖**成立；没有完整声明时，从受影响 Stage 开始保守失效后缀。
源码 MVP 绑定可恢复的 source snapshot 与保守 `treeHash`，不承诺知道任意源码修改只影响哪个 Story。
该 treeHash 排除 Record、Audit、journal、receipt、runtime 快照和 staging。本 attempt 的输入树固定，代码编辑及 `stage-save` 记作 output/progress overlay；保存自己的进度不使自己的 inputHash 失效。完成时校验输出树，下一 Stage 消费新输出树；独立用户修改按新输入或冲突处理。真正消费的上游产物另以 manifest 显式绑定。
未来要缩小源码失效范围，必须先建立可验证的依赖和验证覆盖，不能由模型主观认定“无关文件”。
旧 receipt 保留为历史证据；stale 仅使其失去当前放行资格，不删除历史或修改原始 approval。
当前 snapshot 把整个 `flow.json` 纳入每个 Stage hash；初期可保留保守行为，后续再缩小到实际执行规则。
缩小 hash 范围必须有失效测试支撑，不能以减少重跑为由遗漏治理规则。

<a id="handoff"></a>

### 3.6 跨 Flow 使用 immutable handoff

复用 requirements analysis 现有 `DeliveryContract`，把它消费的 artifact/evidence 绑定到可恢复 manifest。
合同至少绑定 upstream Record/revision、source revision、Scope hash、选中 Story 的 revision/contentHash 和依赖版本。
路径与 hash 只说明“是什么”，manifest 的 restore reference 才说明“丢失后从哪里拿回”。
Git revision 也不足以恢复尚未纳入 Git 的交付文件，这些文件必须有另外的不可变内容来源。

现有 `assessDeliveryContract` 只检查 dependency 是否在 Scope；implementation 还必须验证依赖闭包。
每个依赖要么包含在本次选中范围并按合法顺序交付，要么绑定已完成且版本匹配的交付结果。
闭包校验拒绝未知 dependency 与循环依赖。已完成依赖还必须证明其代码/产物已经包含于本次 implementation 基线，或者先恢复并整合后重新验证；另一个 worktree 存在完成 receipt 并不证明当前代码可用。
不能把“Story 在 Sprint Scope 里”当成“它已经实现”。这只是输入校验，不需要增加通用 DAG 调度器。

版本处理规则：

- downstream 固定消费一个已批准合同，不自动切换到上游最新文件。
- 上游进入新 DRAFT 后，旧 approved snapshot 仍保留可读、可恢复和审计记录。
- 选中 Story 或其依赖变化，显式 rebase 后失效受影响执行结果；审批绑定随变化重新判断。
- 未选中 Story 变化，保留现有 `SCOPE_ACKNOWLEDGEMENT_REQUIRED` 规则，明确确认新的 Scope 版本。
- 只有路径变化而内容一致，可更新定位信息；不借此改变被批准的内容版本。

<a id="workspace-scale"></a>

### 3.7 单 workspace 限制与多任务整合

首期继续一个 workspace 一个 active Record、一个 writer；恢复不会顺便放宽共享目录并发写入规则。
requirements analysis 当前在另一个 Record active 时拒绝 `change-approve` reopen；不能修改 `pdlc/.state/current` 绕过。
需要并行调整上游与开发下游时，使用独立 worktree/workspace 和明确版本的 handoff。
跨 workspace 复制受控记录时必须保留来源和合同身份，并避免同一个 Record 被两个 writer 同时修改。

```text
Versioned harness
  + Workspace A: Requirements analysis
  + Workspace B: Implementation / Story group 1
  + Workspace C: Implementation / Story group 2
  + Workspace D: POC
```

整合步骤明确为：冻结各交付 source revision 和 manifest → 在整合 workspace 合并 → 解决冲突 → 生成新 treeHash。
随后运行受合并影响的验证，重新判断审批有效性，最后生成整合后的交付证据；已有分支成功不等于合并结果成功。
代码冲突、上游合同冲突或互斥 Scope 都返回具体负责人和处理动作；系统不自动选择业务含义冲突的一方。
worktree 隔离不代表外部服务隔离，测试环境和外部写入仍需其 Adapter 明确提供并发边界。

<a id="scale-tests"></a>

### 3.8 large scale 分三个维度逐步验证

下面是建议验收目标，**尚未测量，不构成性能承诺**；记录冷启动/恢复耗时、文件读取数、峰值内存和输入 token 数。

| 维度 | 建议样本 | 目标与观察点 |
| --- | --- | --- |
| 定义数量 | 100 个 Flow、1,000 个 Knowledge 项 | 增加无关定义不增加 worker 正文；正文只加载匹配资源 |
| 单任务长度 | 500 个已保存工作单元、100 次中断 | 恢复读取当前摘要和所需引用，不重放全部对话和历史 attempt |
| 多任务 | 8 个独立 workspace 同时执行 | 无跨 workspace 锁竞争或记录串写；各自可独立恢复 |
| 同目录争用 | 同一 workspace 两个 writer | 只有合法 writer 能提交，第二个得到准确、可处理的状态 |

先用 metadata 做 applicability 筛选，再读命中的内容；定义索引和内容缓存可删除重建，不是新的权威数据源。
命中的必需资源必须验证 hash；不能因为缓存命中就接受已经变化的文件。
全量配置 lint 放在 Harness CI；正常 resume 避免持续全量扫描历史记录和无关资源正文。
索引绑定 Harness revision 与 Project Overlay metadata generation/hash；它们变化后重新筛选，确保新增强制规则能被发现。冷启动或索引丢失允许读取全量 applicability metadata，正文仍按匹配加载；不能在未读取元数据前就断言某项无关。分别测量冷启动元数据成本和热恢复正文成本。
无关 planned Flow 的实现损坏不应阻断修复已持久化的执行记录；启用和执行时再验证该 Flow 的完整契约。
无法判断是否适用的 mandatory Policy 元数据错误仍需明确报错，不能把错误当成“不匹配”跳过。

<a id="flow-changes"></a>

### 3.9 局部修改点与完成条件

| 源码边界 | 局部修改 |
| --- | --- |
| `core/flow-engine.ts`、`core/flow-executor.ts` | 统一执行入口与窄 `planNext` 扩展，恢复逻辑只保留一份 |
| `core/harness-context.ts`、`core/discipline-guidance.ts` | 统一 activation 输入与 Hook applicability |
| `core/discipline-resolver.ts`、相关 schemas | 保留现有匹配语义，逐步迁移 Baseline 依赖范围 |
| `core/context-receipt.ts`、`core/stage-agent.ts` | 绑定真实输入、执行身份和产物内容，保留历史 receipt |
| `delivery-flows/product-requirements-analysis/` | 扩展现有合同验证、依赖闭包与 immutable handoff |
| `delivery-flows/poc/` | 显式审批映射，收回 POC 特有进度规则 |

完成条件是两个 active Flow 用同一故障注入套件通过恢复验收，backend/web-ui 的 Hook 选择差异可自动验证。
添加测试 Flow 无须修改事务或 resume 主逻辑；选中 Story 变更能触发 rebase，无关资源变更不增加 worker 正文。
完整恢复与发布顺序以 [运行恢复协议](#runtime-recovery) 和 [实施、验收与迁移](#rollout) 为准。

<a id="agent-protocol"></a>

## 四、普通模型与 Agent 协议

Agent 从 Runner 获得当前工作、准确输入和一个下一动作；不从旧聊天重建流程，也不直接维护运行状态。

<a id="next-action"></a>

### 4.1 Agent 只处理一个下一动作

```text
Fresh session + recordId
          |
          v
Runner resume -> recover -> verify -> resolve
          |
          v
     One nextAction
          |
   +------+------+----------------+
   |             |                |
Run action   Invoke worker   Wait / Human boundary
   |             |
   +------ Result + validation
                 |
                 v
            Runner resume
```

`resume` 先维护未完成事务、检查执行者状态、核对文件，再返回唯一下一动作。
`status` 在与 writer 相同的短锁保护下只读一致状态，不恢复文件、派发 worker 或修改审计。
发现 pending 事务只报告 `recovery_required` 诊断，由宿主调用 `resume` 恢复；它不是新增 nextAction 类型。
同一个 nextAction 可以携带原因和事实摘要，不能把多个互斥命令交给模型猜选。
Runner 负责排序、复用、失效和恢复判定；模型不能根据聊天自行跳过某个 Stage。

#### 拟增 CLI / API

仅新增顶层 `resume`；运行写入复用现有 `action` 入口，审批仍用既有 checkpoint/readiness 入口。
下列 `stage-start`、`stage-save`、`stage-result` 是拟增的共享内部 action，不是现有可运行命令。

```text
bun .pdlc/cli.ts resume --record IMPL-042 --root /workspace/project
bun .pdlc/cli.ts status --record IMPL-042 --root /workspace/project
bun .pdlc/cli.ts action stage-start --input <request.json> --actor <identity>
bun .pdlc/cli.ts action stage-save --input <progress.json> --actor <identity>
bun .pdlc/cli.ts action stage-result --input <result.json> --actor <identity>
```

`FlowEngine.resume(options)` 调用通用恢复，再请现有 Flow Executor 判断业务允许的下一动作。
共享 runtime action 由 `FlowEngine.action` 分派，避免每个 Flow 复制运行状态写入逻辑。
Flow 自有 action 继续按其声明校验；共享 action 名称保留并检查冲突，不开放任意动作执行。
完整命令参数由 Runner 返回，Agent 不推导项目路径、操作 ID、审批人或哈希。
`stage-start` 在派发前持久化 attempt、身份和派发意图；`stage-result` 验证并发布结果，两者分别幂等。
worker 必须经过 adapter 的受控 dispatch 入口：它以短事务原子领取一次性 claim，只有本次成功领取的调用可以实际派发；重复请求只查询，不因重读旧成功响应而重新获得派发资格。平台支持时同时使用 attempt 幂等键。宿主不能拿一个可反复读取的合同直接绕过该入口启动 worker。
claim 落盘后崩溃而派发结果未知时，只有确认本地写入已隔离才能 fence 旧 attempt 并新建尝试；否则先确认退出。
长 Stage 通过 `stage-save` 保存已验证部分产物和事实交接，不为每份文件新建 Stage；保存不代表 Stage 已完成。

#### 单一动作响应示例

这是已完成 `stage-start` 后的响应；未开始时先返回 `run_action`，由 Runner 提供相应输入文件。
路径相对于已验证的 project root，哈希值仅在受控 manifest 中保存。

```json
{
  "schemaVersion": 1,
  "recordId": "IMPL-042",
  "stageId": "implementation",
  "attempt": 2,
  "nextAction": {
    "kind": "invoke_worker",
    "actionId": "runner-generated-action-id",
    "adapter": "github-copilot",
    "contractFile": "pdlc/.state/runtime/IMPL-042/implementation/attempt-2/contract.json",
    "resultFile": "pdlc/.state/runtime/IMPL-042/implementation/attempt-2/result.json",
    "resumeToken": "runner-generated-token"
  }
}
```

动作集合为 `run_action / invoke_worker / wait / needs_input / needs_approval / conflict / unsupported / done`。
`wait` 附带可再次查询时间或宿主等待方式；它不会要求模型保持一个长期 Record 写锁。
每条命令提交前重新验证 token 与输入，防止用户改动或另一执行者推进后使用旧动作。
合同和交接文件是 Record 执行事实的生成视图，不是需要另行同步的权威状态。
文件按 `recordId / stageId / attempt` 隔离；Runner 冻结候选字节后再验证，完成结果不可变，后续 attempt 不覆盖它。

<a id="agent-contract"></a>

### 4.2 输入精确，输出简单

合同必须包含当前目标、必要文件、Capabilities、允许修改范围和完成条件。

| 合同字段 | 要求 |
|---|---|
| `mustRead` | 需求、上游产物、适用 Controls、role profile；每项有路径、内容哈希、来源和用途 |
| `capabilities` | 每个必需 Capability 的候选 Skills、产物、约束和交接要求 |
| `readableSource` | 固定 Git tree 或受控快照，以及允许查阅的源码范围 |
| `writeScope` | 本 attempt 的隔离输出或明确授权的源码；禁止模型直接写控制状态 |
| `completionCriteria` | 可机器验证的条件与需要人工判断的条件分别声明 |
| `previousWork` | 已验证文件、已完成事项、未完成事项和失败的外部动作引用 |

不能预先知道 implementation 将查阅的所有源码，因此区分必读输入和允许查阅的固定源码版本。
缺上下文时从 Runner 增补；不让模型独立扫描全部 Discipline，也不把整仓库塞进提示词。
MVP 保守绑定 source tree 与必要的未提交文件快照；仅记 `HEAD` 不能覆盖 dirty working tree。
上下文超预算时按依赖分段提供，不能静默省略必需 Controls、Capability 或验收条件。
文件缺失和当前文件存在用户改动是不同情况：前者可按来源恢复，后者必须保留并报告冲突。

模型只返回实际工作、实际选用的 Skills 和证据路径；Runner 构建 ID、时间、哈希、receipt 和 Audit。
结果 token 由合同透传。真实 trace 由 adapter 从宿主调用结果捕获或原样转送，不信任模型自报成功。
宿主拿不到真实执行来源时必须标明未验证，不得声称已通过真实 worker 验证。

```json
{
  "resumeToken": "runner-generated-token",
  "outcome": "completed",
  "summary": "Implemented the approved behavior and verified acceptance cases.",
  "capabilities": [
    {
      "capability": "engineering.implementation",
      "selectedSkills": ["implementation-guidance"],
      "summary": "Implemented the approved behavior.",
      "artifacts": ["src/example.ts"],
      "evidence": ["pdlc/evidence/IMPL-042/test-report.txt"]
    }
  ],
  "remaining": []
}
```

Capability 与 Skill 名称为示意，真实允许值由当前 Hook 解析结果生成。
`outcome` 可为 `completed / incomplete / needs_input`；它是模型报告，最终 execution 状态由 Runner 判断。
`remaining` 记录事实交接，不保存思考过程，也不能代替 Flow 定义决定下一 Stage。
Runner 校验 token、完整 Capability 覆盖、Skills 候选集、路径权限、产物字节和验收结果，再生成 receipt。
自动生成元数据不等于自动声称 Policy 已满足、Skill 已使用或测试已通过；事实仍需实际结果与证据。
格式合法不代表专业结果正确，原有业务验证、独立检查和必要审批继续保留。

<a id="shared-skill"></a>

### 4.3 简短共享 Skill 替换提案

把长篇手工恢复、receipt 拼装与命令选择说明移入 Runner；共享 Skill 保留下面的执行纪律。
这段是拟替换文本，实施时同步 adapter 入口，不能先改文档而让 Runner 仍返回旧合同。

```text
1. Resolve the requested record and call the internal Runner resume entry.
2. Follow the single nextAction returned by the Runner. Do not infer progress from chat history.
3. Read the exact required context. Request missing context through the Runner.
4. Invoke the required worker with the unchanged contract only after the adapter accepts a durable dispatch claim. Inspect duplicate tokens; never redispatch them.
5. Return actual work results and evidence paths using the supplied result schema.
6. Let the Runner validate and persist results. Never edit controlled state or forge a receipt.
7. After a recoverable error, follow the Runner's repair action and bounded retry budget.
8. Ask the user only for the input, approval, or conflict decision named by nextAction.
9. Never bypass a governed checkpoint or emulate an unsupported required worker.
10. Call resume again after the action completes or the host reconnects.
```

<a id="retry-boundaries"></a>

### 4.4 技术恢复与必要暂停分开

重试预算按稳定 action 和错误类别保存，默认最多三次自动尝试；新会话不能清零后无限重试。
锁忙与正常 `wait` 不消耗错误重试次数，也不能因等待超时就假定原 worker 已退出。
格式错误返回具体字段与小型修复输入；不重放全部上下文，也不重做已提交工作。
次数耗尽保存失败事实并给出具体修复下一步，例如补回指定来源、修正指定字段或处理指定冲突；不进入永久 `blocked` 状态。

| 情况 | 自动处理或返回动作 |
|---|---|
| 已提交但响应丢失 | 相同 operation ID 返回原结果，不重复 revision 或审计事件 |
| journal 未完成、原持有者已退出 | 在恢复锁保护下完成事务；不让模型删锁 |
| 同一 worker 仍运行 | 返回 `wait`，支持的平台按 execution ref 查询或连接 |
| worker 状态未知 | 可隔离其本地写入且拒绝旧结果时才允许新 attempt；否则先确认退出 |
| 缺失文件且有验证来源 | 恢复相同字节并验哈希 |
| 文件存在用户改动 | 返回 `conflict`，保留用户版本 |
| 输入或配置改变 | 旧动作失效，重算相关后续 Stage；旧产物保留来源 |
| 外部写入结果未知 | 按服务端 operation key 或查询接口核对；无法确认则明确暂停 |
| 业务答案缺失 | 返回 `needs_input`，只请求能解除当前缺口的信息 |
| 审批缺失或已过期 | 返回 `needs_approval`，呈现需要审批的完整可审查产物 |
| 平台缺少 required worker 能力 | 返回 `unsupported`，说明支持条件与可转移平台 |
| schema / 权限 / 完整性错误 | 能安全修复则返回修复动作；否则说明准确条件，不循环盲试 |

每个 attempt 至多一次派发，成功执行使用一个 required worker；同一 Stage 至多一个获准发布结果的 active attempt。
被 fencing 的旧 worker 可以尚未退出，但它必须只能写独立暂存区，不能继续修改共享源码或发布结果。
普通文件系统锁或拒收旧 receipt 本身不能隔离源码写入；缺少实际写入隔离时必须等待或确认旧 worker 退出。
外部副作用另行核对；本地 fencing 不能撤销已经发出的网络操作。

<a id="platform-support"></a>

### 4.5 模型与平台最低支持

模型需要能遵循单一动作、读取指定文件、执行授权工具、返回小 JSON，并遵守审批和 worker 边界。
能力不足导致专业工作失败时应诚实留下可接手结果，不把更换模型视为自动绕过检查的理由。

| 平台声明 | 最低处理要求 |
|---|---|
| `dispatch` | 真实启动 required worker，获得可核验的执行引用 |
| `inspect` / `attach` | 分别声明是否能查询状态、重接执行；不能把两者混称为 resume |
| `cancel` | 声明能否取消及如何确认退出；取消请求不等于已停止 |
| `isolatedWrites` | 声明能否将旧 attempt 的本地写入限制在隔离目录或工作树 |
| `externalOperationLookup` | 外部写入能否查询或依靠服务端幂等键识别重复 |

历史审计快照仅 GitHub Copilot 声明 `native-subagent`，Codex adapter 没有声明；这是该快照的仓库支持情况，实施前须重新核对。
当前共享 Skill 强制 required worker 并禁止 inline 模拟，不能为了普通模型静默降级。
实施时把 “exactly once per Stage” 修订为“每 attempt 至多一次派发，成功执行使用一个 required worker”，同步 schema、Skill、adapter 和测试。
无 native worker 平台提前返回 `unsupported`。MVP 可以只有一个真实验证通过的 adapter，不需要先抽象所有平台。

交付用户只看到恢复结果与需要参与的业务动作；内部 CLI、哈希和 journal 不进入默认用户流程。

```text
+------------------------------------------+
| Atlas PDLC                               |
| 已恢复：需求与上一阶段已验证产物           |
| 当前阶段：Implementation                  |
| 下一步：继续实现已批准的范围               |
+------------------------------------------+
| 仅需审批时：请确认本次交付验收结果         |
+------------------------------------------+
```

<a id="rollout"></a>

## 五、实施、验收与迁移

实施分六批：事务与幂等、文件清单、Stage resume、统一适用条件与多 Flow、Implementation 本地范围与普通模型实跑、规模验证与渐进迁移。

所有批次都应先把历史诊断变成回归用例，再修改实现。目录归位在恢复契约稳定后进行，避免功能变化和大面积移动同时发生。旧 Record 不伪造执行历史；升级为可恢复格式后，不兼容的旧 Runner 不得继续写入。

最终至少演示：启动一个真实交付 → 做到 Stage 中途 → 保存进度 → 杀掉 Runner 或宿主 → 新会话换普通模型 → 自动恢复并继续 → 到审批点才请求批准 → 多次重试没有重复状态推进或文件覆盖。

同一套故障矩阵覆盖 POC、需求分析、Implementation 本地范围及新增测试 Flow。若新增 Flow 仍需要复制锁、事务恢复或改写 Core resume 分支，重构尚未达到目标。

<a id="implementation-plan"></a>

### 5.1 分批 PR 与源码落点

以下源码路径均相对于第 1.1 节的历史 V2 审计基线；实施前核对目标分支路径与已有能力，本文不把这些计划视为已实现。
每批同步 TypeScript 类型、JSON schema 与运行时校验；不先放宽校验来让新流程“跑起来”。

| PR | 内容与主要源码落点 | 合入前验收 |
|---|---|---|
| 1 | `.pdlc/core/controlled-mutation.ts`、`lock.ts`、`audit.ts`、`state.ts` 与 `flow-engine.ts` 初始化；journal、幂等、自动恢复 | 各崩溃窗口可恢复；尾部 JSONL、并发重复 operation token、并发初始化不丢数据；冻结候选字节与最终提交一致 |
| 2 | `context-receipt.ts`、`harness-context.ts`、`evidence.ts`、`commands/context.ts`；manifest 与输入输出内容绑定 | 需求、dirty source、输出篡改可检测；缺失文件准确恢复；用户文件不被覆盖 |
| 3 | `types.ts`、`schemas/`、`flow-engine.ts`、`flow-executor.ts`、`cli.ts`、`platform-adapters/`；execution 与 resume | fresh session 返回唯一下一步；并发重复 token 只派发一次；冻结候选字节验证；未知 worker 安全 fencing；结果只接纳一次 |
| 4 | `discipline-guidance.ts`、`harness-context.ts`、`poc-progress.ts` 与各 Flow Executor；applicability 和业务类型归位 | POC、需求分析行为保持；跨 Flow 无污染；planned Flow 不被当作 executable |
| 5 | `.pdlc/tests/fixtures/implementation-local/`、共享 Skill 与 adapter；先验证本地交付 fixture | 已批准范围→实现→验证→本地交付；真实普通模型与换模型恢复通过；正式 implementation 仍为 planned |
| 6 | 索引、保留策略、规模用例、README/参考文档和迁移入口 | 多 Record 数据规模、空间增长、备份恢复、分批迁移与回滚演练 |

PR 1 的恢复机制首先覆盖现有受控命令；PR 3 再暴露统一恢复动作，不能等所有新运行对象完成才修残留锁。
PR 4 可以并行准备只读拆分，但合入基于 PR 3 的共同契约；PR 5 用测试 fixture 证明 runtime 可复用。
正式 `implementation` 保持 `planned`，完整 required release stages 尚未实现前不改成 executable，也不通过跳过它们声称交付完成。
PR 6 再验证扩大使用规模，避免在文件恢复和 worker 正确性未建立前引入队列、数据库或多机协调。

<a id="session-tests"></a>

### 5.2 验收必须包含真正的新会话

| 场景 | 通过条件 |
|---|---|
| 子进程在每个持久化边界被终止 | 一次恢复得到一致状态；无手工删锁；未重复审批或提交 |
| 每 Stage 后清空聊天，只给入口和 Record ID | 能定位正确 Stage、读取准确输入、复用有效结果 |
| worker 写出部分文件后终止宿主 | 下次启动可连接或安全新建 attempt；未验证半成品不冒充完成 |
| 已确认完成后丢失响应或旧 worker 延迟返回 | 不重派已确认完成的工作；不重复提交或接受被 fencing 的结果 |
| 派发 claim 后崩溃、完成状态未知 | 仅在满足隔离条件后允许新 attempt 重复计算；不得重复接纳状态或外部副作用 |
| 并发重复 token 或验证时 worker 改文件 | 一次有效派发/接纳；验证冻结候选字节，不将后写内容偷换成已验证结果 |
| 中途换目标普通模型 | 从磁盘续做，不需要人为补充旧聊天、锁说明或修 receipt |
| 普通模型首次返回错误 JSON | 获得局部修复提示，修复后可继续，重试次数跨会话保持 |
| 必要文件缺失、被改、来源丢失 | 分别表现为精确恢复、冲突、不可恢复且定位重做入口 |
| POC 与 implementation-local 使用同名 Stage | Record、输入、适用 Discipline 与结果身份正确隔离 |
| 必要审批、外部效果未知、平台能力缺失 | 在对应边界停下，不制造假完成或重复外部副作用 |

自动故障注入和 synthetic trace 只验证机制；真实模型验收必须运行真实 adapter 和 worker。
记录模型/平台版本、样本、人工介入、重试、重复副作用、误复用和验收结果；未执行项明确标为未测。
首轮至少分别进行同模型续做、换普通模型续做和审批边界测试，不把一次成功泛化为所有模型可靠。

<a id="migration"></a>

### 5.3 旧 Record 迁移、上线与回滚

1. 先只读盘点 schema、可读产物、哈希来源和未完成事务，生成逐 Record 迁移报告；保存 Record/Audit/current 与必要快照备份。
2. 老 Record 没有 execution 时保持可读；首次启用先校验并显式建立绑定，不能推断旧 receipt 等于新运行完成。
3. 无法证明内容版本的历史产物标记为未建立恢复绑定，保留原业务状态与审批历史；通过受控重新验证或新 attempt 接续。
4. 先在测试副本、再在少量选定 Record 启用；旧 `wx` 锁与新 advisory lock 不互相排斥，必须先停旧 writer，再切换，禁止两者同时写同一数据集。
5. 分批迁移逐条幂等落盘，失败只暂停该条并保留诊断；不因一条历史坏记录阻止全部只读状态检查。
6. 回滚首先停写并保存新增数据；若格式向后不兼容，旧 Runner 只读或拒绝写，不允许静默丢弃 execution。
7. 只有确认没有后续成功写入时才可恢复迁移前备份；已有新交付进度则用兼容修复版本或经过验证的降级迁移。
8. 不通过清空 Audit、删除 journal 或回退业务审批状态实施回滚；不可恢复的历史来源必须如实保留限制。

版本门禁在迁移数据前先部署到受支持的 Runner 入口：写入前检查存储 schema 与最低 writer 版本，拒绝不兼容格式。未经补丁的历史可执行文件不能被新 JSON 字段自动约束，必须退出并从实际写入入口移除；不把“文档要求旧版本拒写”当作已有技术保护。

上线完成标准是：支持范围内的可恢复中断无需人工技术修补，必要边界能准确解释，且每一份复用结果都有可验证来源。
具体文件恢复与事务不变量以 [运行恢复协议](#runtime-recovery) 为准；Flow 扩展与规模边界以 [Flow、Stage 与 Discipline](#flow-stage-discipline) 为准。
