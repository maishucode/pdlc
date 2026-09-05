# Atlas PDLC V2 稳定性重构完整方案

状态：设计提案，尚未实现。编写日期：2026-09-05。

目标是在现有 `Flow → Stage → Discipline → Runner → Adapter` 架构内，补齐可恢复执行协议。让进程中断、新会话接手、普通模型接手和多种 Flow，都依靠相同的持久化事实继续工作。

**核心决定：Runner 负责恢复、文件版本、执行状态与下一步；模型负责当前范围内的专业工作。** 保留现有概念和文件式存储，按小批次修改契约与实现。

补充决定：必需 Capability 与独立执行要求分别声明。普通 Stage 可以由 Subagent 或主 Agent 完成；Runner 负责合法选择和切换执行方式，适用规则、产物校验与审批要求保持一致。AI-DLC 的实际机制、边界和本方案取舍见[参考实现](#aidlc-reference)。

本文是一份可独立阅读的完整方案。新增字段、命令、接口、目录与数值验收目标均属于拟议设计，不表示当前已实现能力或已测性能。历史审计事实与待实施契约分别标注；实施前必须核对目标分支的实际代码状态。

## 目录

| 部分 | 内容 |
|---|---|
| [一、目标与架构边界](#overview) | [历史基线](#baseline)、[恢复保证](#continuity)、[架构](#architecture)、[运行协议](#protocol-overview)、[共同约束](#invariants) |
| [二、运行恢复协议](#runtime-recovery) | [执行身份](#execution-state)、[锁](#writer-lock)、[事务](#journal)、[故障矩阵](#crash-matrix)、[幂等](#idempotency)、[文件恢复](#file-recovery)、[worker](#worker-recovery)、[resume 算法](#resume-algorithm)、[存储与备份](#retention)、[恢复验收](#recovery-tests) |
| [三、Flow、Stage 与 Discipline](#flow-stage-discipline) | [职责](#ownership)、[业务选择](#flow-planning)、[多 Flow](#flow-models)、[适用条件](#applicability)、[失效传播](#invalidation)、[跨 Flow 合同](#handoff)、[并行整合](#workspace-scale)、[规模验证](#scale-tests)、[修改边界](#flow-changes) |
| [四、普通模型与 Agent 协议](#agent-protocol) | [单一下一动作](#next-action)、[输入输出合同](#agent-contract)、[共享 Skill](#shared-skill)、[重试与暂停](#retry-boundaries)、[平台要求](#platform-support)、[执行策略与主 Agent fallback](#execution-policy) |
| [五、实施、验收与迁移](#rollout) | [六批 PR](#implementation-plan)、[真实会话验收](#session-tests)、[迁移与回滚](#migration) |
| [六、AI-DLC 参考实现与取舍](#aidlc-reference) | 已核查的上游机制、fallback 的实现边界、Atlas 采纳范围与固定版本来源 |

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
    inputs / attempts      inline or subagent executor
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
  -> run_action / execute_inline / invoke_worker / wait
  -> needs_input / needs_approval
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
| 执行方式由 Runner 决定 | `inline / prefer_subagent / require_subagent` 区分角色能力与独立性；inline 同样受输入绑定、执行领取和结果校验约束 |
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
  executorMode?: "inline" | "subagent";
  fallbackReason?: string;
  status: "pending" | "running" | "completed" | "interrupted" | "failed";
  inputManifestRef: string;
  outputManifestRef?: string;
  platformExecutionRef?: string;
  progressRef?: string;
};
```

这些字段属于 `Record.execution`，不再增加 Session / Job / Task 状态机。`pending` 的 attempt 为 0，进入 `running` 时必须有正整数 attempt、active attempt ID 与完整输入清单。当前 Flow 中 Stage 引用唯一，暂不引入节点 ID；历史 attempt 的输入、结果与失败原因由不可变运行材料保留。

`running` 同时绑定 `executorMode`；`fallbackReason` 由 Runner 根据实际失败或能力缺失生成。执行策略进入上下文清单与 `contextHash`，实际执行方式属于 attempt：在既定策略允许范围内从 Subagent 转 inline 时保留同一输入 `runKey`，增加 attempt 并保存旧尝试。若改变强制独立执行规则，则属于治理配置变更，必须重新绑定，不能记作普通 fallback。

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

### 2.7 执行者中断与未知结果

启动前先持久化 `running`、attempt ID、输入清单和启动意图，再调用 adapter；获得平台执行引用后立即保存。外部调用与本地 journal 无法组成一个原子事务，故必须处理“已启动但引用尚未保存”的窗口。

本节的 worker 隔离、领取、结果接纳与过期拒收也适用于 inline 主 Agent。开始 inline 工作前，宿主通过相同受控入口领取该 attempt 的执行资格；第二个宿主只能查询或等待。明确验证同一执行者仍在续做时可以恢复原 attempt；原执行者状态未知则按下表处理，不因为“主 Agent 接手”而免除并发写入与外部效果核查。

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

同一机制也用于 Subagent → inline：先判断[执行策略](#execution-policy)是否允许，确认旧执行只写隔离区或已退出，再原子建立新的 inline attempt。复用的是经过校验的进度快照；原始 staging 与未确认的外部动作不能直接当成续做成果。

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
`FlowStep` 仅是 Flow 内部业务建议，不是给 Agent 的响应枚举。Runner 将它映射为[Agent 协议](#next-action)统一的 `nextAction`：`run-stage` 可能需要 `run_action`、`execute_inline`、`invoke_worker` 或等待，`approve` 映射为 `needs_approval`，`complete` 经校验后映射为 `done`。恢复与平台事实由 Core 补足，Flow 不直接给模型调度指令。
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

必需 Capability 表示工作内容不可省略，不自动要求 Subagent。Stage 声明默认 `executionPolicy`；已匹配的强制 Policy/Hook 可将它收紧为 `require_subagent`，Runner 记录来源并统一解析。Project Overlay 不得降低强制独立要求，Flow 不另建一份 fallback 规则。多个贡献使用同一次 Stage 合同，主 Agent inline 时也逐项完成并验证所有必需 Capability。

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
   +------------+-------------+----------------+
   |            |             |                |
Run action   Main inline   Subagent       Wait / Human boundary
   |            |             |
   +------------+-------------+
                |
       Result + validation
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
`stage-start` 在开始工作前持久化 attempt、身份、实际执行方式及执行意图；`stage-result` 验证并发布结果，两者分别幂等。
worker 必须经过 adapter 的受控 dispatch 入口：它以短事务原子领取一次性 claim，只有本次成功领取的调用可以实际派发；重复请求只查询，不因重读旧成功响应而重新获得派发资格。平台支持时同时使用 attempt 幂等键。宿主不能拿一个可反复读取的合同直接绕过该入口启动 worker。
`execute_inline` 由主 Agent 执行同一份工作合同，并走同一个宿主执行领取与结果接纳入口；它不派发 Subagent，也不生成假的 Subagent trace。`run_action` 只表示 Runner 给出的受控操作，不能用它隐藏一段没有执行身份的模型工作。
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

动作集合为 `run_action / execute_inline / invoke_worker / wait / needs_input / needs_approval / conflict / unsupported / done`。
inline 响应沿用相同字段结构，各值绑定本次 inline attempt；`nextAction.kind` 为 `execute_inline`。执行方式由 Runner 生成，模型不能改写 `invoke_worker` 为 `execute_inline` 后提交原 token。
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
| `execution` | 解析后的执行策略、实际方式、规则来源与 fallback 原因；由 Runner 生成 |

不能预先知道 implementation 将查阅的所有源码，因此区分必读输入和允许查阅的固定源码版本。
缺上下文时从 Runner 增补；不让模型独立扫描全部 Discipline，也不把整仓库塞进提示词。
MVP 保守绑定 source tree 与必要的未提交文件快照；仅记 `HEAD` 不能覆盖 dirty working tree。
上下文超预算时按依赖分段提供，不能静默省略必需 Controls、Capability 或验收条件。
文件缺失和当前文件存在用户改动是不同情况：前者可按来源恢复，后者必须保留并报告冲突。

模型只返回实际工作、实际选用的 Skills 和证据路径；Runner 构建 ID、时间、哈希、receipt 和 Audit。
结果 token 由合同透传。真实 trace 由 adapter 从宿主调用结果捕获或原样转送，不信任模型自报成功。
Subagent 模式下，宿主拿不到真实执行来源时必须标明未验证，不得声称已通过真实 worker 验证。inline 模式记录实际主 Agent 执行及可取得的宿主来源，不要求不存在的 Subagent trace；该结果可以满足普通工作验收，不能满足强制独立调用证明。

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
4. Follow execute_inline or invoke_worker exactly, after the guarded host entry grants execution ownership. Never reuse a claim to start another executor.
5. Return actual work results and evidence paths using the supplied result schema.
6. Let the Runner validate and persist results. Never edit controlled state or forge a receipt.
7. After a recoverable error, follow the Runner's repair action and bounded retry budget.
8. Ask the user only for the input, approval, or conflict decision named by nextAction.
9. Never bypass a governed checkpoint, choose your own fallback, or claim inline self-checks are independent reviews.
10. Call resume again after the action completes or the host reconnects.
```

<a id="retry-boundaries"></a>

### 4.4 技术恢复与必要暂停分开

重试预算按同一 `runKey` 下的逻辑工作与错误类别保存，默认最多三次自动尝试；更换 action ID、attempt、执行方式或会话都不能清零。对 `prefer_subagent` 的派发失败，预算最多分配两次给 Subagent（初试与一次缩减非必要上下文的重试），随后进入策略允许的 inline 接手；工具已知不可用时直接选 inline，不消耗预算做必败调用。普通结果格式修复仍受对应错误类别预算约束。
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
| `prefer_subagent` 且平台没有 Subagent | 生成合法 inline attempt 与 `execute_inline`，保留同一任务要求 |
| Subagent 重试耗尽且允许 fallback | 安全撤销旧 attempt 发布资格后转 inline，记录原因与已复用进度 |
| `require_subagent` 且缺少合格执行能力 | 返回 `unsupported` 与支持条件；如规则已有替代验收路径，按该路径处理 |
| 独立审查未完成 | 保存真实未完成结果与原因；按既定治理规则请求替代审查或人工判断，不能假报通过 |
| schema / 权限 / 完整性错误 | 能安全修复则返回修复动作；否则说明准确条件，不循环盲试 |

每个 attempt 只有一种实际执行方式和一个获准执行者；Subagent 模式至多一次逻辑派发，inline 模式不派发 worker。同一 Stage 至多一个获准发布结果的 active attempt。
被 fencing 的旧 worker 可以尚未退出，但它必须只能写独立暂存区，不能继续修改共享源码或发布结果。
普通文件系统锁或拒收旧 receipt 本身不能隔离源码写入；缺少实际写入隔离时必须等待或确认旧 worker 退出。
外部副作用另行核对；本地 fencing 不能撤销已经发出的网络操作。

<a id="platform-support"></a>

### 4.5 模型与平台最低支持

模型需要能遵循单一动作、读取指定文件、执行授权工具、返回小 JSON，并遵守审批和 worker 边界。
能力不足导致专业工作失败时应诚实留下可接手结果，不把更换模型视为自动绕过检查的理由。

| 平台声明 | 最低处理要求 |
|---|---|
| `inline` | 宿主能交付完整合同、受控领取执行、限制写入范围并回传结果；所有支持平台的普通工作基线 |
| `dispatch` | 声明是否支持独立执行；支持时真实启动 worker 并获得可核验的引用 |
| `inspect` / `attach` | 分别声明是否能查询状态、重接执行；不能把两者混称为 resume |
| `cancel` | 声明能否取消及如何确认退出；取消请求不等于已停止 |
| `isolatedWrites` | 声明能否将旧 attempt 的本地写入限制在隔离目录或工作树 |
| `externalOperationLookup` | 外部写入能否查询或依靠服务端幂等键识别重复 |

历史审计快照仅 GitHub Copilot 声明 `native-subagent`，Codex adapter 没有声明；这是该快照的仓库支持情况，实施前须重新核对。
历史共享 Skill 强制 required worker 并禁止 inline 模拟；本方案把合法 inline 执行定义为独立模式，不能仅删除旧限制后让模型自行选择。
实施时同步修订 `requiredStageInvocation` 的类型/校验、AGENTS.md、共享 Skill、adapter 和测试：必需 Capability 始终完成，只有 `require_subagent` 必须独立调用；每 attempt 的执行方式必须可验证。旧 native receipt 保留原含义，新增 inline receipt 明确记录真实方式。
无 native worker 的平台只要达到 inline 基线，仍能执行普通 Stage；强制独立的任务提前返回具体支持条件。MVP 验证一个平台的原生调用和禁用 Subagent 后的 inline 路径，不需要先支持所有平台。用隔离 CLI worker 作为独立执行适配可以后续补充，未经验证的 shell 调用不能自动满足 `require_subagent`。

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

<a id="execution-policy"></a>

### 4.6 执行策略与主 Agent fallback

以下为 Atlas 的拟议实现，依据第六部分的 AI-DLC 调研补足其协议与 runtime 之间的缺口。它同时修订早期方案中“所有 required worker 都必须是真实 Subagent”的统一限制。

在现有 Stage 定义中增加一个 `executionPolicy`，由适用 Controls/Hook 收紧，并随上下文清单绑定；不新增 Flow、Job 或另一套调度引擎：

| 策略 | 初次执行 | Subagent 不可用或失败 | 验收要求 |
|---|---|---|---|
| `inline` | 主 Agent 读取完整合同后直接执行 | 无需 Subagent | 所有必需 Capability、产物与适用 Controls 仍须验证 |
| `prefer_subagent` | 平台支持时优先独立 worker | 已知无工具则直接 inline；调用失败经过有界重试后允许 inline | 两种方式使用相同业务输入、规则与产物契约，记录实际方式 |
| `require_subagent` | 使用已验证的独立执行适配 | 不自动改为主 Agent；返回可用平台、重试或已声明的替代验收路径 | 必须满足真实独立执行要求，inline 自检不能代替 |

普通实现、分析和文档 Stage 以 `prefer_subagent` 为建议默认，交互密集 Stage 可明确使用 `inline`。迁移必须逐项分类：未知的历史 required worker 先保留独立要求，只有确认它是专业能力要求而非独立性要求时才改为可 fallback，不能批量删除强制约束。

`prefer_subagent` 本身声明了等价任务范围内的 inline 退路，所以缺工具时不用再次询问技术性确认。切换若要求新增权限、扩大交付范围或豁免独立审查，则按既有治理入口处理。用户只要求继续工作不等于批准修改业务标准。

独立性还须相对于实际产物作者验证：另一个角色名或一条身份首行不构成独立执行证明。要求独立审查的 Capability 必须取得与作者不同、可核验且上下文符合隔离要求的执行来源。首期沿用现有验证 Stage 承接这类工作；若某配置让同一次单执行者任务既写产物又独立审查自己，应在配置校验时指出冲突，不引入通用多人调度器来掩盖它。

#### 确定的选择与切换步骤

```text
Resolve required work + execution policy + adapter capabilities
    |
    +-- inline ------------------------------> execute_inline
    |
    +-- prefer_subagent
    |     +-- available ---------------------> invoke_worker
    |     |      +-- subagent retries spent --+
    |     +-- unavailable -------------------+--> safe handoff --> execute_inline
    |
    +-- require_subagent
          +-- qualified executor ------------> invoke_worker
          +-- unavailable -------------------> explicit support or review boundary
```

Runner 按以下顺序执行切换，模型只执行返回的一个动作：

1. 校验当前生效策略、输入绑定与宿主能力；分清“没有工具”“调用失败”“仍在运行”“结果未知”。不把等待当失败，不借 fallback 重放未知外部效果。
2. 若允许重试，缩减非必要历史摘要，保留所有必需规则、输入文件与当前工作范围。重试预算沿用第 4.4 节，切换模式不能重新获得一轮预算。
3. 需要换执行者时先确认旧执行已退出，或只能写旧 attempt 的隔离目录；在短事务中撤销旧发布资格，增加 attempt，保存 `executorMode: inline` 和准确 `fallbackReason`。事务中断按同一 journal 恢复。
4. 从绑定来源重建输入与已接纳进度，重新生成完整 inline 合同：主导及辅助角色定义、必要知识、强制规则、文件清单、可写范围和验收条件。不能只返回一句“你自己做”。
5. Runner 返回 `execute_inline`；宿主先经受控入口领取，再让主 Agent 完成当前工作，使用 `stage-save` / `stage-result` 保存结果。重复读取动作不等于再次获得执行资格，旧 token、旧输出和重复领取不能获得新 attempt 的发布资格。
6. Runner 依据相同业务完成条件验证结果，生成真实 inline receipt，再重新判断后续 Stage 与 gate。执行模式变化不自动使业务审批失效，也不能让已经过期的输入审批恢复有效。

两个执行方式共用同一业务内容清单；合同的 attempt 路径、执行来源、token 会随新尝试更新。普通 fallback 保持输入内容哈希不变，主 Agent 的新编辑作为新 attempt 的输出。来源丢失、用户并发修改、未知外部结果等仍按原恢复协议处理。

#### 真实回执与独立审查的出口

回执至少关联原有 `runKey`、attempt、输入输出 manifest，以及 Runner 记录的 `executorMode`、执行来源和 fallback 原因。Subagent 结果要有真实派发来源；inline 结果如实标记主 Agent 执行。两者都验证产物与实际测试证据，模型不能自报一种更强的执行方式。

审查没有完成时保存 `incomplete`/失败事实和具体原因，不能当作 `completed` 或批准。借鉴 AI-DLC 的处理方向，让失败成为可处理结果而非永远缺失的 receipt，但 Atlas 的下一步由自身 Controls 决定：

- advisory 审查可以在规则明确允许时携带“未完成审查”的说明进入人工判断，不能显示成通过；
- 必需独立审查安排另一个合格执行者，或进入已经定义的例外审批；没有例外规则就保持未满足，给出准确解除条件；
- 主 Agent 可继续规则允许的修复、补材料等工作，其自检明确标为自检，不能替代独立审查证明；
- “保持未完成”不等于允许跳到依赖它的后续 Stage，任何跳过仍由 Flow 的合法动作决定。

这样无需为普通模型新增专用状态机：模型越普通，越应减少让它自行判断策略、修复收据和选择恢复文件的任务。是否达到稳定支持，最终由两种执行方式的真实会话验收证明。

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
| 3 | `types.ts`、`schemas/`、`flow-engine.ts`、`flow-executor.ts`、`cli.ts`、`platform-adapters/`；execution、策略解析、inline/subagent 与 resume | fresh session 返回唯一下一步；两种方式受控领取；无 Subagent 时合法 inline；切换中断可恢复；过期结果只拒收、不重复推进 |
| 4 | `discipline-guidance.ts`、`harness-context.ts`、`poc-progress.ts` 与各 Flow Executor；applicability、独立要求和业务类型归位 | 必需 Capability 与独立执行分别校验；强制独立不能被 overlay 或 fallback 放宽；跨 Flow 无污染；planned Flow 不可执行 |
| 5 | `.pdlc/tests/fixtures/implementation-local/`、AGENTS.md、共享 Skill 与 adapter；先验证本地交付 fixture | 正常调用、禁用 Subagent、重试后 inline、换普通模型均跑完本地交付；审查不可用有真实诊断；正式 implementation 仍为 planned |
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
| 启动前禁用 Subagent，策略为 `prefer_subagent` | 直接取得完整 inline 合同，主 Agent 完成相同工作；不反复调用不存在的工具 |
| Subagent 重试耗尽后由主 Agent 接手 | 安全新建 attempt，复用正确文件与进度；实际 executor、fallback 原因与总重试预算可追踪 |
| fallback 事务中途退出或两个宿主同时接手 | 恢复同一切换决定，只有合法执行者可发布；旧 worker 迟到结果不能覆盖 inline 结果 |
| inline 执行中途再次清空聊天或更换模型 | 从已接纳进度继续，不能因 mode 切换而丢失 mandatory Policy、Knowledge 或验收条件 |
| `require_subagent` 没有合格执行者 | 不冒充独立审查；返回明确支持条件或规则已有的替代验收动作 |
| 主 Agent 提交伪造 native trace 或旧 attempt token | 拒收；合法 inline receipt 则可满足普通工作验收 |
| 普通模型首次返回错误 JSON | 获得局部修复提示，修复后可继续，重试次数跨会话保持 |
| 必要文件缺失、被改、来源丢失 | 分别表现为精确恢复、冲突、不可恢复且定位重做入口 |
| POC 与 implementation-local 使用同名 Stage | Record、输入、适用 Discipline 与结果身份正确隔离 |
| 必要审批、外部效果未知、平台能力缺失 | 在对应边界停下，不制造假完成或重复外部副作用 |

自动故障注入和 synthetic trace 只验证机制；Subagent 路径须运行真实 adapter/worker，inline 路径须实际禁用 Subagent 并让主 Agent 完成工作，不能只改返回字段来模拟成功。
记录模型/平台版本、实际执行方式、fallback 原因、样本、人工介入、重试、重复副作用、误复用和验收结果；未执行项明确标为未测。
首轮至少分别进行同模型续做、换普通模型续做、无 Subagent 交付、调用失败后接手和审批边界测试，不把一次成功泛化为所有模型可靠。上游 AI-DLC 的测试与文档只能作为设计证据，不替代 Atlas 验收。

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

执行策略迁移同步检查旧 Hook/Stage 的独立性含义，保留已有 native receipt 的语义，不把历史主 Agent 工作补写成已发生的独立调用。只有新 Runner、schema、AGENTS.md、Skill 和 adapter 的策略协议一起可用后才启用 inline fallback，避免提示词允许而结果校验仍拒收。

版本门禁在迁移数据前先部署到受支持的 Runner 入口：写入前检查存储 schema 与最低 writer 版本，拒绝不兼容格式。未经补丁的历史可执行文件不能被新 JSON 字段自动约束，必须退出并从实际写入入口移除；不把“文档要求旧版本拒写”当作已有技术保护。

上线完成标准是：支持范围内的可恢复中断无需人工技术修补，必要边界能准确解释，且每一份复用结果都有可验证来源。
具体文件恢复与事务不变量以 [运行恢复协议](#runtime-recovery) 为准；Flow 扩展与规模边界以 [Flow、Stage 与 Discipline](#flow-stage-discipline) 为准。

<a id="aidlc-reference"></a>

## 六、AI-DLC 参考实现与取舍

本节调研 AWS `awslabs/aidlc-workflows`，固定到提交 `a277af218f0df7f325d3b8be7b6d90fce2c5bd40`。下文分别标明上游已有协议、从源码得出的限制，以及 Atlas 拟议设计，避免把文档中的承诺当成已验证的运行保证。本次只做源码与协议审阅，没有运行上游测试，也没有实施 Atlas 的相关改动。

关键启发是：**执行某项专业工作、创建独立 Subagent、通过独立审查，是三种不同要求。** 主 Agent 可以完成许多专业工作；是否必须委派，取决于执行策略和独立性要求，不能仅凭“存在一个专家角色”决定。

<a id="aidlc-execution"></a>

### 6.1 上游已有：主 Agent 执行是正式模式

AI-DLC 的 Stage 定义选择协作方式；主导专家、辅助专家是职责，未必对应独立运行的 Agent。四种已使用的模式如下。[协作模式协议](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/aidlc-common/protocols/stage-protocol-ensemble.md#L7-L36)

| 上游模式 | 谁实际执行 | 如何交付完成证据 |
|---|---|---|
| `inline` | 主 Agent 加载主导与辅助专家的角色和知识，依次采用各专业视角 | Stage 产物；不要求辅助专家贡献文件 |
| `subagent` | 委派主导专家；如有辅助专家，再分别委派并由主导专家整合 | 有辅助专家时，检查各自贡献文件 |
| `pipeline` | 按声明顺序逐个委派，后续执行者接收上游产物 | 每一环节在当前执行中的持久收据 |
| `mob` | 主导专家起草，辅助专家分别贡献，再有限轮次整合与讨论 | 辅助专家贡献文件，并保留异议 |

当前编译后的 Stage 表共有 33 个 Stage：29 个 `inline`、2 个 `subagent`、1 个 `pipeline`、1 个 `mob`。29 个 `inline` 包括 3 个通过初始化工具完成的初始化阶段，不能表述成“29 个阶段全部靠主模型独立推理完成”。另外，Stage 本体采用 `inline`，也不表示它配置的后续独立 Reviewer 可以省略。[当前 Stage 表](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/harness/copilot/skills/aidlc/SKILL.md#L214-L253)

例如架构与安全可以是主 Agent 必须依次采用的专业视角；只有当工作要求独立参与者或独立审查时，才需要把相关身份落实为独立执行。上游明确禁止为了 `inline` Stage 的辅助角色而额外派发 Agent。[Inline 规则](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/aidlc-common/protocols/stage-protocol-ensemble.md#L24-L34)

### 6.2 上游已有：代码决定下一步，文件承载交接

上游稳定性的主要来源是一套明确的交接协议，并非某个模型能一直记住整个过程。

```text
next reads state and returns one directive
                    |
                    v
conductor loads context and performs the work
                    |
                    v
report records the outcome and transition
                    |
                    +--------------------> next
```

`next` 读取状态与编译后的 Stage 图，返回一个结构化指令；主 Agent 执行后调用 `report`，由工具提交阶段转换。协议不允许主 Agent 自行维护另一套阶段顺序或直接调用状态生命周期方法。[Forwarding Loop](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/harness/copilot/skills/aidlc/SKILL.md#L32-L46)

上下文交付也具体到内容和文件：`load-steering` 交付当前规则内容；`inline_context_paths` 列出主 Agent 必须读取的角色及知识文件；随后才读取 Stage 定义与输入产物。派发的 Agent 则通过配置加载自身角色，brief 携带当前任务、相关路径和完整适用规则。Agent 名字或文件路径出现在提示词里，本身不代表上下文已经读入。[上下文加载与规则交付](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/harness/copilot/skills/aidlc/SKILL.md#L87-L88)、[派发上下文预算](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/aidlc-common/protocols/stage-protocol-ensemble.md#L103-L108)

产物内容留在磁盘，Subagent 返回的摘要只列产物路径、关键决定、问题和下一步。协作产物分文件写入；支持者贡献文件需要正确身份标记；Pipeline 在每次返回后记录当前执行的环节收据。完成检查并不只看一句“已完成”。这些是结构性证据，仍不能单独证明产物质量或真实的进程隔离。[文件交接](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/aidlc-common/protocols/stage-protocol-ensemble.md#L18-L36)、[返回摘要](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/aidlc-common/protocols/stage-protocol-ensemble.md#L40-L70)

新会话从产物、阶段记忆、Audit、状态文件和派生图重新定位；发生冲突时，Audit 是事件事实的校准依据。协议明确恢复的是决定、进度和上下文，不是上一个会话的聊天缓冲区。Atlas 应吸收这种恢复目标，但仍需落实前文的事务、文件快照和执行隔离，不能把“能够读取旧文件”直接当成精确恢复。[恢复来源](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/aidlc-common/protocols/stage-protocol-recovery.md#L8-L36)

<a id="aidlc-fallback"></a>

### 6.3 上游已有：普通派发失败后可以由主 Agent 接手

上游的普通 Subagent 失败恢复协议覆盖超时、工具报错，以及返回内容被截断或不完整。处理路径如下。[失败恢复原文](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/aidlc-common/protocols/stage-protocol-ensemble.md#L110-L116)

```text
Subagent call fails or returns incomplete output
                    |
                    v
Retry once with a smaller relevant context
                    |
              Still failing
                    |
                    v
User chooses the resolution
  +-- Run it here: continue in the main conversation
  +-- Skip and revisit: leave unfinished and revisit later
                    |
                    v
Record the failure and chosen resolution
```

因此，“主 Agent 继续完成这项工作”是上游明确允许的退路；但该协议要求用户选择，不能说成引擎已经在能力不足时自动切换执行模式。`Skip and revisit` 也保留“未完成”事实，不等于自动满足下游输入或批准 Stage。

另一种常被误读的退路是“不能并行时改为串行”。上游允许 `subagent` 和 `mob` 中的独立派发串行运行，但要求每个参与者仍遵守原有信息边界。这解决并发能力不足，仍然依赖独立委派能力，**不等同于没有 Subagent 时由主 Agent 模拟所有参与者**。[串行派发约束](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/aidlc-common/protocols/stage-protocol-ensemble.md#L32-L36)

### 6.4 上游已有：Reviewer 不完整时记录真实失败

Reviewer 有单独的恢复协议。工具将审查请求绑定到当时的产物与源文件，校验审查附录的完整性、身份、迭代号和请求挑战；不完整的附录不能充当有效结论。[Reviewer 完成判定](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/aidlc-common/protocols/stage-protocol-reviewer.md#L145-L157)

| 情况 | 上游处理 |
|---|---|
| 第一次审查不完整 | 清理本次不完整附录，以同一待处理请求重试一次，不增加审查迭代 |
| 重试仍不完整 | 停止重复请求，记录 `NOT-READY`，原因是审查未在预算内完成 |
| Advisory 审查 | 进入带有真实失败说明的人工关口 |
| Adversarial 审查仍有迭代 | 开始下一次有界审查；没有真实发现时不让实现者盲目返工 |
| Adversarial 审查耗尽迭代 | 带着失败事实进入人工关口 |

这份终态收据既不伪造通过，也不让引擎永远等一份不存在的审查。它允许流程到达处理失败的关口，**不表示质量门槛自动满足，更不是将主 Agent 自检冒充独立审查**。[Reviewer 重试与失败收据](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/aidlc-common/protocols/stage-protocol-reviewer.md#L158-L187)

<a id="aidlc-limits"></a>

### 6.5 源码推断：尚不能承诺所有 Stage 自动无损降级

结合协议与当前代码，可以确认下面的衔接缺口；这些是源码审阅结论，不是本次运行故障复现。

| 检查点 | 当前实现 | 对主 Agent 接手的影响 |
|---|---|---|
| 执行模式 | `run-stage` 的 `mode` 直接取自 Stage 定义 | 未见按宿主 Subagent 能力改写模式的统一机制 |
| Inline 上下文 | `subagent` / `pipeline` 不构建 inline 角色清单 | 协议选择接手后，仍需补齐主 Agent 的上下文交付 |
| 协作完成校验 | 仍按声明模式检查贡献文件与 Pipeline 收据 | 改由主 Agent 工作，并不会自动改变对应完成条件 |
| 恢复逃生开关 | 可关闭协作证据检查以恢复确实已执行但丢失证据的工作 | 这是有限恢复手段，不能作为日常缺能力降级策略 |

依据分别是 [指令模式生成](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/tools/aidlc-orchestrate.ts#L3208-L3220)、[Inline 角色选择](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/tools/aidlc-orchestrate.ts#L2807-L2824)、[协作与 Pipeline 校验](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/tools/aidlc-orchestrate.ts#L7095-L7227)。

跨宿主的保证也有边界。例如 Copilot 的 Hook 依赖项目受信任，非交互运行还需要额外配置；缺失这些条件时，部分保护 Hook 不会运行。README 也明确提醒能力较弱的模型可能遗漏步骤或提前推进审批。因此，不能从“适配多个 Harness”推导出“任何模型、任何宿主都稳定”。[Copilot 条件](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/harness/copilot/skills/aidlc/SKILL.md#L124-L129)、[模型限制](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/README.md#L72-L77)

历史 [RFC 105](https://github.com/awslabs/aidlc-workflows/issues/105) 曾提出安全 Subagent 失败后，改由 `aidlc-security-check` Skill / 主会话继续检查，仍无有效结果则拒绝放行。它只能作为设计背景：当前检视的源码树未交付这一命名 Skill，不能据此认定该 fallback 已在当前版本实现。本文以固定提交的实际协议和代码为实现证据；Issue 是历史讨论，链接不具有固定提交的不可变性。

### 6.6 Atlas 拟议设计：吸收协议，补齐模式切换

以下是本方案的设计选择，**不是声称 AI-DLC 已有这些接口或 Atlas 已经实现**。具体字段、状态机和验收要求以前五部分为准。

| 采纳的原则 | Atlas 的处理 |
|---|---|
| 专业职责与进程拓扑分开 | Discipline 规定必须做什么；Stage 执行策略决定用主 Agent 还是独立 Worker |
| 主 Agent 执行是正式路径 | 支持 `inline`；`prefer_subagent` 允许能力不足或有界失败后接手 |
| 独立性需要明确声明 | 只有确有独立性要求时使用 `require_subagent`；自检如实记录为自检 |
| 单一结构化下一步 | Runner 决定恢复、补上下文、执行或真实等待，普通模型不自行拼接路由 |
| 文件承载工作交接 | 两种执行方式接收等价的已验证输入、适用规则、有效进度和验收条件 |
| 失败必须具有终态 | 保存失败原因、重试预算和后续选择，避免永久等待缺失的 Worker 或收据 |

不直接照搬三件事：其一，不把每次允许的技术降级都变成新的用户确认；前文策略已授权、且不改变独立性与业务审批时，由 Runner 执行切换。其二，不通过关闭证据校验、伪造参与者贡献或伪造 Review 来换取继续。其三，不把协议里的“接着做”当成恢复保证，切换前仍须处理旧 Worker 的发布权限、真实外部副作用和文件版本。

最终验收应分别覆盖原生主 Agent 执行、无 Subagent、派发超时、能力中途丢失、重复派发、切换后旧 Worker 返回，以及普通模型在新会话中接手。只有这些路径使用同一套事实校验并通过实际宿主测试，才能把“不因缺少 Subagent 被机械阻塞”作为产品能力。

<a id="aidlc-sources"></a>

### 6.7 参考资料与证据范围

上游协议与代码链接均固定到同一提交，避免后续主分支变化使结论失去对应关系；RFC 105 的 Issue 链接仅提供历史背景。

- [协作拓扑、文件交接与失败恢复协议](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/aidlc-common/protocols/stage-protocol-ensemble.md#L5-L116)：主要说明协议要求，不代表所有要求已由代码强制执行。
- [Reviewer 的有界恢复](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/aidlc-common/protocols/stage-protocol-reviewer.md#L145-L187)：说明不完整审查如何形成真实终态。
- [Copilot 的主 Agent 循环](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/harness/copilot/skills/aidlc/SKILL.md#L32-L46)：展示普通执行协议，其他 Harness 的具体能力仍需逐一验证。
- [引擎的协作完成校验](https://github.com/awslabs/aidlc-workflows/blob/a277af218f0df7f325d3b8be7b6d90fce2c5bd40/core/tools/aidlc-orchestrate.ts#L7095-L7227)：用于核对协议退路与当前代码之间尚未接通的部分。
