/**
 * 水路检修隔离求解器（纯函数，不修改输入）。
 *
 * 模型：管网为无向图。节点通过「无阀管段」与「带阀管段」相连。
 * 关闭一个阀门等价于从图中移除该带阀管段。
 * 目标：在「当前开启」的阀门中寻找关阀组合，使得
 *   1. 漏点与所有供水点断开；
 *   2. 每个保供出口仍能连通至少一个供水点。
 * 优选规则：关阀数最少；同数时按阀门编号排序后的列表取字典序最小。
 */

export interface Pipe {
  id: string;
  from: string;
  to: string;
}

export interface ValvedPipe extends Pipe {
  open: boolean;
}

export interface Network {
  nodes: string[];
  /** 无阀管段 */
  pipes: Pipe[];
  /** 带阀管段，阀门编号 id 全网唯一 */
  valvedPipes: ValvedPipe[];
}

export interface Query {
  /** 供水点节点 */
  supplies: string[];
  /** 漏点节点 */
  leak: string;
  /** 必须不断水的出口节点 */
  outlets: string[];
}

export interface OutletStatus {
  outlet: string;
  connected: boolean;
  /** 该出口当前能连通的供水点 */
  reachableSupplies: string[];
}

export interface Solution {
  /** 需要关闭的阀门编号（升序） */
  closed: string[];
  leakIsolated: boolean;
  outletStatus: OutletStatus[];
}

export interface SolveOk {
  status: 'ok';
  openValveCount: number;
  minClosed: number;
  /** 全部最优（关阀数最少）方案，按字典序排列 */
  solutions: Solution[];
  /** 最优方案总数超过展示上限时为 true */
  truncated: boolean;
}

export interface SolveNoSolution {
  status: 'no-solution';
  openValveCount: number;
  reason: string;
}

export interface SolveInvalid {
  status: 'invalid';
  errors: string[];
}

export type SolveResult = SolveOk | SolveNoSolution | SolveInvalid;

/** 一条参与韧性评估的管段（无阀管段或当前开启的带阀管段）。 */
export interface ActiveEdge {
  id: string;
  from: string;
  to: string;
}

/** 可按管段失效评估的出口。 */
export interface ResilienceRow {
  outlet: string;
  assessable: true;
  /** 使其失去全部供水至少需失效的不同管段数；当前已断水时为 0 */
  minFailures: number;
  /** 当前是否已断水（在当前阀门开闭状态下无任何供水点可达） */
  alreadyCut: boolean;
  /** 一组达到 minFailures 的管段编号（升序）；已断水时为空清单 */
  witnessPipes: string[];
}

/** 出口与供水点同名，无法按管段失效评估。 */
export interface ResilienceUnassessableRow {
  outlet: string;
  assessable: false;
  reason: string;
}

export type ResilienceResultRow = ResilienceRow | ResilienceUnassessableRow;

export interface ResilienceOk {
  status: 'ok';
  /** 参与评估的管段总数（无阀管段 + 当前开启的带阀管段；自环不计） */
  activePipeCount: number;
  /** 按所需失效数升序（无法评估的排在最后） */
  rows: ResilienceResultRow[];
}

export interface ResilienceInvalid {
  status: 'invalid';
  errors: string[];
}

export type ResilienceResult = ResilienceOk | ResilienceInvalid;

// ============ 供水能力核验 ============

export interface CapacityQuery {
  /** 供水点节点 */
  supplies: string[];
  /** 保供出口节点 */
  outlets: string[];
  /** 供水点节点名 -> 供给上限（非负整数） */
  supplyCaps: Record<string, number>;
  /** 保供出口节点名 -> 需求量（非负整数） */
  outletDemands: Record<string, number>;
  /**
   * 重点保供出口节点名（须包含在 outlets 中），缺省或空数组表示全部按普通出口处理。
   * 仅「重点出口优先配水」使用；供水能力核验与增容建议忽略本字段。
   */
  priorityOutlets?: string[];
}

/** 最小割项目类型：供水点供给上限 / 连通管段 / 出口需求。 */
export type CapacityCutKind = 'supply' | 'pipe' | 'demand';

export interface CapacityCutItem {
  kind: CapacityCutKind;
  /** 供给上限与出口需求为节点名，管段为管段（含阀门）编号 */
  id: string;
  /** 该项对总供给的限制容量：上限值 / 1 / 需求量 */
  capacity: number;
}

export interface CapacitySupplyRow {
  supply: string;
  cap: number;
  /** 最大分配下该供水点实际供出量 */
  used: number;
}

export interface CapacityOutletRow {
  outlet: string;
  demand: number;
  /** 最大分配下该出口获配量 */
  allocated: number;
  /** 缺口 = 需求量 - 获配量 */
  shortfall: number;
  fullySupplied: boolean;
}

export interface CapacityOk {
  status: 'ok';
  /** 参与输水的管段总数（无阀管段 + 当前开启的带阀管段；自环不计） */
  activePipeCount: number;
  totalSupplyCap: number;
  totalDemand: number;
  /** 总供给最大分配（最大流） */
  totalAllocated: number;
  /** 总缺口 = 总需求 - 总获配 */
  totalShortfall: number;
  supplyRows: CapacitySupplyRow[];
  rows: CapacityOutletRow[];
  /**
   * 一组限制总供给的最小割项目（容量合计恒等于总获配）。
   * 最大流为 0 时为空清单。
   */
  cutItems: CapacityCutItem[];
  cutCapacity: number;
}

export interface CapacityInvalid {
  status: 'invalid';
  errors: string[];
}

export type CapacityResult = CapacityOk | CapacityInvalid;

// ============ 重点出口优先配水 ============

/** 出口配水类别：重点（优先满足）/ 普通。 */
export type OutletCategory = 'priority' | 'normal';

export interface PriorityCapacityOutletRow {
  outlet: string;
  /** 重点 / 普通 */
  category: OutletCategory;
  demand: number;
  /** 两级目标下该出口获配量 */
  allocated: number;
  /** 缺口 = 需求量 - 获配量 */
  shortfall: number;
  fullySupplied: boolean;
}

export interface PriorityCapacityOk {
  status: 'ok';
  /** 参与输水的管段总数（无阀管段 + 当前开启的带阀管段；自环不计） */
  activePipeCount: number;
  /** 重点出口数 */
  priorityOutletCount: number;
  totalSupplyCap: number;
  totalDemand: number;
  /** 第一级目标值：重点出口总获配量（在该模型下可达到的最大值） */
  priorityAllocated: number;
  /** 重点出口总需求与总缺口 */
  priorityDemand: number;
  priorityShortfall: number;
  /** 第二级目标值：在不减少重点总获配的前提下，全部出口总获配量（最大） */
  totalAllocated: number;
  /** 普通出口总获配量（= 总获配 - 重点获配） */
  normalAllocated: number;
  /** 总缺口 = 总需求 - 总获配 */
  totalShortfall: number;
  /** 按填写表顺序给出的各出口类别、获配量与缺口 */
  rows: PriorityCapacityOutletRow[];
}

export interface PriorityCapacityInvalid {
  status: 'invalid';
  errors: string[];
}

export type PriorityCapacityResult = PriorityCapacityOk | PriorityCapacityInvalid;

// ============ 管段增容建议 ============

/** 增容目标容量：参与输水的管段容量由 1 提至 2。 */
export const EXPANSION_TARGET_CAPACITY = 2;
/** 增容改造的管段条数上限 */
export const MAX_EXPANSION_PIPES = 2;

/** 一个增容方案：将 upgraded 中各管段容量由 1 提至 2 后的总获配情况。 */
export interface ExpansionPlan {
  /** 参与改造的管段编号（升序）；空数组表示不改造（基线） */
  upgraded: string[];
  /** 该方案下的总获配量 */
  totalAllocated: number;
  /** 相对基线（不改造）的增量 */
  gain: number;
}

export interface ExpansionOk {
  status: 'ok';
  /** 可候选改造的管段总数（无阀管段 + 当前开启的带阀管段；自环与已关阀不计） */
  activePipeCount: number;
  /** 不改造时的总获配量（与供水能力核验的总获配一致） */
  baseline: number;
  /** 推荐方案：总获配量最高 → 改造条数最少 → 管段编号列表字典序最小 */
  recommended: ExpansionPlan;
  /** 单条改造的最优方案；无候选管段时为 null */
  bestSingle: ExpansionPlan | null;
  /** 两条组合改造的最优方案；候选不足两条时为 null */
  bestPair: ExpansionPlan | null;
}

export interface ExpansionInvalid {
  status: 'invalid';
  errors: string[];
}

export type ExpansionResult = ExpansionOk | ExpansionInvalid;

/** 参与组合的开启阀门数量上限 */
export const MAX_OPEN_VALVES = 12;
/** 收集的最优方案数上限（防止结果爆炸） */
export const MAX_SOLUTIONS = 100;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === 'string' && x.length > 0)) return null;
  return v as string[];
}

/** 解析并校验拓扑 JSON，返回网络或错误列表。 */
export function parseNetwork(raw: unknown): { network?: Network; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { errors: ['拓扑 JSON 必须是一个对象，包含 nodes / pipes / valvedPipes 三个字段。'] };
  }

  const nodes = asStringArray(raw.nodes);
  if (!nodes || nodes.length === 0) {
    errors.push('nodes 必须是非空字符串数组。');
  }
  const nodeSet = new Set(nodes ?? []);
  if (nodes && nodeSet.size !== nodes.length) {
    errors.push('nodes 中存在重复节点。');
  }

  const parsePipes = (v: unknown, field: string, requireOpen: boolean): (Pipe[] | ValvedPipe[] | null) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      errors.push(`${field} 必须是数组。`);
      return null;
    }
    const out: (Pipe | ValvedPipe)[] = [];
    for (let i = 0; i < v.length; i++) {
      const p = v[i];
      if (!isRecord(p) || typeof p.id !== 'string' || !p.id ||
          typeof p.from !== 'string' || !p.from ||
          typeof p.to !== 'string' || !p.to) {
        errors.push(`${field}[${i}] 必须包含非空字符串字段 id / from / to。`);
        continue;
      }
      if (requireOpen && typeof p.open !== 'boolean') {
        errors.push(`${field}[${i}]（${p.id}）缺少布尔字段 open。`);
        continue;
      }
      out.push(
        requireOpen
          ? { id: p.id, from: p.from, to: p.to, open: p.open as boolean }
          : { id: p.id, from: p.from, to: p.to }
      );
    }
    return out;
  };

  const pipes = parsePipes(raw.pipes, 'pipes', false) as Pipe[] | null;
  const valvedPipes = parsePipes(raw.valvedPipes, 'valvedPipes', true) as ValvedPipe[] | null;

  // 阀门编号唯一性校验（阀门编号在带阀管段间必须唯一）
  if (valvedPipes) {
    const seen = new Set<string>();
    for (const vp of valvedPipes) {
      if (seen.has(vp.id)) errors.push(`阀门编号「${vp.id}」重复，阀门编号必须唯一。`);
      seen.add(vp.id);
    }
  }
  // 无管段编号也不允许（无阀管段与带阀管段之间也不允许重号，便于结果指代）
  if (pipes && valvedPipes) {
    const valvedIds = new Set(valvedPipes.map((p) => p.id));
    const pipeSeen = new Set<string>();
    for (const p of pipes) {
      if (valvedIds.has(p.id)) errors.push(`管段编号「${p.id}」同时出现在 pipes 与 valvedPipes 中。`);
      if (pipeSeen.has(p.id)) errors.push(`无阀管段编号「${p.id}」重复。`);
      pipeSeen.add(p.id);
    }
  }
  // 端点必须已声明
  if (nodes) {
    for (const p of [...(pipes ?? []), ...(valvedPipes ?? [])]) {
      if (!nodeSet.has(p.from)) errors.push(`管段「${p.id}」的起点「${p.from}」未在 nodes 中声明。`);
      if (!nodeSet.has(p.to)) errors.push(`管段「${p.id}」的终点「${p.to}」未在 nodes 中声明。`);
    }
  }

  if (errors.length > 0 || !nodes || !pipes || !valvedPipes) {
    return { errors: errors.length > 0 ? errors : ['拓扑解析失败。'] };
  }
  return { network: { nodes, pipes, valvedPipes }, errors: [] };
}

/** 校验查询条件（供水点 / 漏点 / 保供出口）。 */
export function validateQuery(network: Network, query: Query): string[] {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);
  if (query.supplies.length === 0) errors.push('至少需要指定一个供水点。');
  for (const s of query.supplies) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  if (!query.leak) {
    errors.push('必须指定漏点。');
  } else if (!nodeSet.has(query.leak)) {
    errors.push(`漏点「${query.leak}」不在节点列表中。`);
  }
  if (query.leak && query.supplies.includes(query.leak)) {
    errors.push(`漏点「${query.leak}」不能同时是供水点。`);
  }
  for (const o of query.outlets) {
    if (!nodeSet.has(o)) errors.push(`保供出口「${o}」不在节点列表中。`);
  }
  const openCount = network.valvedPipes.filter((v) => v.open).length;
  if (openCount > MAX_OPEN_VALVES) {
    errors.push(
      `当前开启的阀门有 ${openCount} 个，超过上限 ${MAX_OPEN_VALVES} 个；` +
      '请先在输入中将部分阀门标记为关闭（"open": false）后再求解。'
    );
  }
  return errors;
}

/** 构建无向邻接表：无阀管段全部保留，带阀管段仅在开启且未被关闭时保留。 */
function buildAdjacency(network: Network, closed: Set<string>): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  };
  for (const p of network.pipes) {
    addEdge(p.from, p.to);
    addEdge(p.to, p.from);
  }
  for (const vp of network.valvedPipes) {
    if (!vp.open || closed.has(vp.id)) continue; // 已关闭的阀门视为断开
    addEdge(vp.from, vp.to);
    addEdge(vp.to, vp.from);
  }
  return adj;
}

function bfs(adj: Map<string, string[]>, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** 评估某个关阀组合，返回该方案详情（不修改输入网络）。 */
export function evaluate(network: Network, query: Query, closed: string[]): Solution {
  const closedSet = new Set(closed);
  const adj = buildAdjacency(network, closedSet);
  const reachBySupply = new Map<string, Set<string>>();
  for (const s of query.supplies) {
    reachBySupply.set(s, bfs(adj, s));
  }
  const leakIsolated = query.supplies.every((s) => !reachBySupply.get(s)!.has(query.leak));
  const outletStatus: OutletStatus[] = query.outlets.map((outlet) => {
    const reachableSupplies = query.supplies.filter((s) => reachBySupply.get(s)!.has(outlet));
    return { outlet, connected: reachableSupplies.length > 0, reachableSupplies };
  });
  return { closed: [...closed].sort(), leakIsolated, outletStatus };
}

function isValid(sol: Solution): boolean {
  return sol.leakIsolated && sol.outletStatus.every((o) => o.connected);
}

/**
 * 按关阀数从小到大枚举组合；组合本身按「编号升序列表」的字典序生成，
 * 因此同一关阀数下第一个可行解即字典序最小解。
 */
export function solve(network: Network, query: Query): SolveResult {
  const queryErrors = validateQuery(network, query);
  if (queryErrors.length > 0) return { status: 'invalid', errors: queryErrors };

  const openValves = network.valvedPipes.filter((v) => v.open).map((v) => v.id).sort();
  const n = openValves.length;

  for (let k = 0; k <= n; k++) {
    const solutions: Solution[] = [];
    let truncated = false;
    // 字典序生成 k 组合
    const idx = Array.from({ length: k }, (_, i) => i);
    while (true) {
      if (k > 0) {
        const closed = idx.map((i) => openValves[i]);
        const sol = evaluate(network, query, closed);
        if (isValid(sol)) {
          if (solutions.length < MAX_SOLUTIONS) {
            solutions.push(sol);
          } else {
            truncated = true;
          }
        }
      } else {
        const sol = evaluate(network, query, []);
        if (isValid(sol)) solutions.push(sol);
      }
      if (k === 0) break;
      // 下一个组合
      let i = k - 1;
      while (i >= 0 && idx[i] === n - k + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
    if (solutions.length > 0) {
      return { status: 'ok', openValveCount: n, minClosed: k, solutions, truncated };
    }
  }
  return {
    status: 'no-solution',
    openValveCount: n,
    reason:
      '在全部当前开启阀门的任意关阀组合中，均无法同时满足「漏点与所有供水点断开」且「每个保供出口仍连通至少一个供水点」。' +
      '请检查拓扑、供水点与保供出口设置，或考虑增设阀门 / 旁通管段。',
  };
}

function uniquePreservingOrder(values: string[]): string[] {
  return [...new Set(values)];
}

/** 参与韧性评估的管段：无阀管段与当前开启的带阀管段均按单条计；自环对连通无意义，忽略。 */
function collectActiveEdges(network: Network): ActiveEdge[] {
  const edges: ActiveEdge[] = [];
  for (const p of network.pipes) {
    if (p.from !== p.to) edges.push({ id: p.id, from: p.from, to: p.to });
  }
  for (const vp of network.valvedPipes) {
    if (vp.open && vp.from !== vp.to) edges.push({ id: vp.id, from: vp.from, to: vp.to });
  }
  return edges;
}

/** 仅依据当前阀门开闭状态，从全部供水点出发做连通性遍历。 */
function reachableFromSupplies(
  edges: ActiveEdge[],
  indexOf: Map<string, number>,
  supplyIdx: Set<number>
): boolean[] {
  const n = indexOf.size;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    const u = indexOf.get(e.from)!;
    const v = indexOf.get(e.to)!;
    adj[u].push(v);
    adj[v].push(u);
  }
  const seen = new Array<boolean>(n).fill(false);
  const queue: number[] = [];
  for (const s of supplyIdx) {
    if (!seen[s]) {
      seen[s] = true;
      queue.push(s);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj[cur]) {
      if (!seen[next]) {
        seen[next] = true;
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Dinic 最大流：节点编号为 0..n-1，另有一个超级源点 n。 */
class Dinic {
  private readonly head: number[];
  private readonly next: number[] = [];
  private readonly to: number[] = [];
  private readonly cap: number[] = [];
  private readonly level: number[];
  private readonly it: number[];

  constructor(private readonly n: number) {
    this.head = new Array(n + 1).fill(-1);
    this.level = new Array(n + 1).fill(-1);
    this.it = new Array(n + 1).fill(0);
  }

  get source(): number {
    return this.n;
  }

  /** 增加一条容量为 cap 的有向弧（自动附带零容量反向弧）。 */
  addArc(u: number, v: number, cap: number): void {
    this.next.push(this.head[u]);
    this.to.push(v);
    this.cap.push(cap);
    this.head[u] = this.next.length - 1;

    this.next.push(this.head[v]);
    this.to.push(u);
    this.cap.push(0);
    this.head[v] = this.next.length - 1;
  }

  /** 无向单位容量边：两个方向各一条容量 1 的弧。 */
  addUndirectedUnit(u: number, v: number): void {
    this.addArc(u, v, 1);
    this.addArc(v, u, 1);
  }

  private bfs(s: number, t: number): boolean {
    this.level.fill(-1);
    this.level[s] = 0;
    const queue = [s];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (let a = this.head[u]; a !== -1; a = this.next[a]) {
        if (this.cap[a] > 0 && this.level[this.to[a]] === -1) {
          this.level[this.to[a]] = this.level[u] + 1;
          queue.push(this.to[a]);
        }
      }
    }
    return this.level[t] !== -1;
  }

  private dfs(u: number, t: number, pushed: number): number {
    if (u === t || pushed === 0) return pushed;
    while (this.it[u] !== -1) {
      const a = this.it[u];
      const v = this.to[a];
      if (this.cap[a] > 0 && this.level[v] === this.level[u] + 1) {
        const flow = this.dfs(v, t, Math.min(pushed, this.cap[a]));
        if (flow > 0) {
          this.cap[a] -= flow;
          this.cap[a ^ 1] += flow;
          return flow;
        }
      }
      // 该弧无法再增广，推进当前弧指针
      this.it[u] = this.next[a];
    }
    return 0;
  }

  maxFlow(s: number, t: number): number {
    let flow = 0;
    while (this.bfs(s, t)) {
      for (let i = 0; i < this.it.length; i++) this.it[i] = this.head[i];
      while (true) {
        const pushed = this.dfs(s, t, Infinity);
        if (pushed === 0) break;
        flow += pushed;
      }
    }
    return flow;
  }

  /**
   * 最大流后在残量网络上可到达汇点 t 的节点集合（沿残量弧反向 BFS）。
   * 该集合是「最靠近出口」的最小割：在所有等优割中隔离范围最小、
   * 不会为了切掉一个出口而把整个供水侧都划入割集，便于据此安排巡检。
   */
  sinkSideCut(t: number): boolean[] {
    const inSinkSide = new Array(this.n + 1).fill(false);
    inSinkSide[t] = true;
    const queue = [t];
    while (queue.length > 0) {
      const v = queue.shift()!;
      for (let a = this.head[v]; a !== -1; a = this.next[a]) {
        const u = this.to[a]; // a 为 v→u，其配对弧 a^1 为 u→v
        // u→v 仍有残量，则 u 可经 v 到达汇点
        if (this.cap[a ^ 1] > 0 && !inSinkSide[u]) {
          inSinkSide[u] = true;
          queue.push(u);
        }
      }
    }
    return inSinkSide;
  }
}

/**
 * 保供韧性巡检：对每个保供出口，计算在当前阀门开闭状态下，使其失去全部供水
 * （与所有供水点同时断开）至少需要失效多少条不同管段，并给出一组达到该数量的
 * 管段编号。无阀管段与开启的带阀管段均按单条失效计；已关阀门不参与。
 * 多个供水点作为整体（超级源点以无穷大容量接入），环路与并行管段分别计数。
 * 结果即无向多重图（单位边容）上「供水点集合 → 出口」的最小边割，由最大流求得。
 */
export function inspectResilience(network: Network, query: Query): ResilienceResult {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);
  if (query.supplies.length === 0) errors.push('至少需要指定一个供水点。');
  for (const s of query.supplies) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  for (const o of query.outlets) {
    if (!nodeSet.has(o)) errors.push(`保供出口「${o}」不在节点列表中。`);
  }
  if (errors.length > 0) return { status: 'invalid', errors };

  const supplies = uniquePreservingOrder(query.supplies);
  const outlets = uniquePreservingOrder(query.outlets);
  const supplySet = new Set(supplies);

  const edges = collectActiveEdges(network);
  const indexOf = new Map<string, number>();
  network.nodes.forEach((node, i) => indexOf.set(node, i));
  const supplyIdx = new Set(supplies.map((s) => indexOf.get(s)!));
  const reachable = reachableFromSupplies(edges, indexOf, supplyIdx);
  // 超级源点接入管容超过任意真实边割，保证不会成为瓶颈
  const infiniteCap = edges.length + 1;

  const rows: ResilienceResultRow[] = outlets.map((outlet) => {
    if (supplySet.has(outlet)) {
      return {
        outlet,
        assessable: false,
        reason: '出口与供水点同名，无法按管段失效评估。',
      };
    }
    const t = indexOf.get(outlet)!;
    if (!reachable[t]) {
      // 当前阀门开闭状态下已无任何供水点可达：无需失效任何管段
      return { outlet, assessable: true, minFailures: 0, alreadyCut: true, witnessPipes: [] };
    }

    const dinic = new Dinic(network.nodes.length);
    for (const s of supplyIdx) dinic.addArc(dinic.source, s, infiniteCap);
    for (const e of edges) {
      dinic.addUndirectedUnit(indexOf.get(e.from)!, indexOf.get(e.to)!);
    }
    const minFailures = dinic.maxFlow(dinic.source, t);
    const inSinkSide = dinic.sinkSideCut(t);

    // 跨越割线、与出口同侧的边界管段，即一组达到最小失效数的管段（最贴近出口的割）
    const witnessPipes: string[] = [];
    for (const e of edges) {
      const u = indexOf.get(e.from)!;
      const v = indexOf.get(e.to)!;
      if (inSinkSide[u] !== inSinkSide[v]) witnessPipes.push(e.id);
    }
    witnessPipes.sort();
    return { outlet, assessable: true, minFailures, alreadyCut: false, witnessPipes };
  });

  rows.sort((a, b) => {
    if (a.assessable !== b.assessable) return a.assessable ? -1 : 1;
    if (a.assessable && b.assessable && a.minFailures !== b.minFailures) {
      return a.minFailures - b.minFailures;
    }
    return a.outlet.localeCompare(b.outlet, 'zh-Hans-CN');
  });

  return { status: 'ok', activePipeCount: edges.length, rows };
}

/**
 * 带「双向合计容量」无向边的 Dinic。
 *
 * 与韧性巡检使用的 addUndirectedUnit（两个方向各放一条独立容量弧，
 * 两方向可同时各占 1）不同，这里的无向管段在两个方向上**共享同一份容量**：
 * 正/反弧初始容量均为 1，且增广推流后两弧容量之和恒为 1，
 * 因此同一无向管段在任意流分配中双向合计至多占用一次（净流量绝对值 ≤ 1）。
 */
class CapacityDinic {
  private readonly head: number[];
  private readonly next: number[] = [];
  private readonly from: number[] = [];
  private readonly to: number[] = [];
  private readonly cap: number[] = [];
  private readonly initialCap: number[] = [];
  private readonly level: number[];
  private readonly it: number[];

  constructor(private readonly n: number) {
    this.head = new Array(n + 2).fill(-1);
    this.level = new Array(n + 2).fill(-1);
    this.it = new Array(n + 2).fill(0);
  }

  get source(): number {
    return this.n;
  }

  get sink(): number {
    return this.n + 1;
  }

  /** 增加一条有向弧（自动附带零容量反向弧），返回正向弧下标。 */
  addArc(u: number, v: number, cap: number): number {
    this.next.push(this.head[u]);
    this.from.push(u);
    this.to.push(v);
    this.cap.push(cap);
    this.initialCap.push(cap);
    this.head[u] = this.next.length - 1;
    const fwd = this.next.length - 1;

    this.next.push(this.head[v]);
    this.from.push(v);
    this.to.push(u);
    this.cap.push(0);
    this.initialCap.push(0);
    this.head[v] = this.next.length - 1;
    return fwd;
  }

  /**
   * 无向共享容量边：两弧初始容量均为 cap，配对弧更新只做净流量记账，
   * 全程保持 cap[a] + cap[a^1] === cap，双向合计占用不超过 cap（管段为 1）。
   * 返回正向弧（u→v）的下标，供割判定与流量读取使用。
   */
  addUndirectedShared(u: number, v: number, cap: number): number {
    this.next.push(this.head[u]);
    this.from.push(u);
    this.to.push(v);
    this.cap.push(cap);
    this.initialCap.push(cap);
    this.head[u] = this.next.length - 1;
    const fwd = this.next.length - 1;

    this.next.push(this.head[v]);
    this.from.push(v);
    this.to.push(u);
    this.cap.push(cap);
    this.initialCap.push(cap);
    this.head[v] = this.next.length - 1;
    return fwd;
  }

  /** 弧 a 起点。 */
  arcFrom(a: number): number {
    return this.from[a];
  }

  /** 弧 a 终点。 */
  arcTo(a: number): number {
    return this.to[a];
  }

  /** 弧 a 的剩余容量。 */
  residualCap(a: number): number {
    return this.cap[a];
  }

  /** 弧 a 的初始容量。 */
  initialArcCap(a: number): number {
    return this.initialCap[a];
  }

  /** 弧 a 已承载的流量（初始容量 - 剩余容量；共享无向边反向弧可能为负，表示反向净流）。 */
  arcFlow(a: number): number {
    return this.initialCap[a] - this.cap[a];
  }

  private bfs(s: number, t: number): boolean {
    this.level.fill(-1);
    this.level[s] = 0;
    const queue = [s];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (let a = this.head[u]; a !== -1; a = this.next[a]) {
        if (this.cap[a] > 0 && this.level[this.to[a]] === -1) {
          this.level[this.to[a]] = this.level[u] + 1;
          queue.push(this.to[a]);
        }
      }
    }
    return this.level[t] !== -1;
  }

  private dfs(u: number, t: number, pushed: number): number {
    if (u === t || pushed === 0) return pushed;
    while (this.it[u] !== -1) {
      const a = this.it[u];
      const v = this.to[a];
      if (this.cap[a] > 0 && this.level[v] === this.level[u] + 1) {
        const flow = this.dfs(v, t, Math.min(pushed, this.cap[a]));
        if (flow > 0) {
          this.cap[a] -= flow;
          this.cap[a ^ 1] += flow;
          return flow;
        }
      }
      this.it[u] = this.next[a];
    }
    return 0;
  }

  maxFlow(s: number, t: number): number {
    let flow = 0;
    while (this.bfs(s, t)) {
      for (let i = 0; i < this.it.length; i++) this.it[i] = this.head[i];
      while (true) {
        const pushed = this.dfs(s, t, Infinity);
        if (pushed === 0) break;
        flow += pushed;
      }
    }
    return flow;
  }

  /** 最大流后源侧可达节点集合（残量网络 BFS），即标准 s-t 最小割的源侧。 */
  sourceSideCut(s: number): boolean[] {
    const inSourceSide = new Array(this.n + 2).fill(false);
    inSourceSide[s] = true;
    const queue = [s];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (let a = this.head[u]; a !== -1; a = this.next[a]) {
        const v = this.to[a];
        if (this.cap[a] > 0 && !inSourceSide[v]) {
          inSourceSide[v] = true;
          queue.push(v);
        }
      }
    }
    return inSourceSide;
  }
}

/** 非负整数校验：必须为整数且 ≥ 0；拒绝 1.5、-1、NaN、Infinity。 */
function readNonNegativeInt(value: unknown): { ok: true; n: number } | { ok: false } {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return { ok: false };
  }
  return { ok: true, n: value };
}

interface ValidatedCapacityQuery {
  supplyCapList: { supply: string; cap: number }[];
  demandList: { outlet: string; demand: number }[];
}

/**
 * 供水能力类查询（核验与增容建议共用）的校验：节点存在性、
 * 供给上限与需求量必须为非负整数。
 * 返回按输入顺序去重后的上限 / 需求清单；有错误时 valid 缺省。
 */
function validateCapacityQuery(
  network: Network,
  query: CapacityQuery
): { valid?: ValidatedCapacityQuery; errors: string[] } {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);

  if (query.supplies.length === 0) errors.push('至少需要指定一个供水点。');
  for (const s of query.supplies) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  if (query.outlets.length === 0) errors.push('至少需要指定一个保供出口。');
  for (const o of query.outlets) {
    if (!nodeSet.has(o)) errors.push(`保供出口「${o}」不在节点列表中。`);
  }

  const supplies = uniquePreservingOrder(query.supplies);
  const outlets = uniquePreservingOrder(query.outlets);

  const supplyCapList: { supply: string; cap: number }[] = [];
  for (const s of supplies) {
    if (!nodeSet.has(s)) continue;
    const raw = query.supplyCaps[s];
    if (raw === undefined) {
      errors.push(`供水点「${s}」缺少供给上限，请填写非负整数。`);
      continue;
    }
    const parsed = readNonNegativeInt(raw);
    if (!parsed.ok) {
      errors.push(`供水点「${s}」的供给上限必须是非负整数（收到：${String(raw)}）。`);
      continue;
    }
    supplyCapList.push({ supply: s, cap: parsed.n });
  }

  const demandList: { outlet: string; demand: number }[] = [];
  for (const o of outlets) {
    if (!nodeSet.has(o)) continue;
    const raw = query.outletDemands[o];
    if (raw === undefined) {
      errors.push(`保供出口「${o}」缺少需求量，请填写非负整数。`);
      continue;
    }
    const parsed = readNonNegativeInt(raw);
    if (!parsed.ok) {
      errors.push(`保供出口「${o}」的需求量必须是非负整数（收到：${String(raw)}）。`);
      continue;
    }
    demandList.push({ outlet: o, demand: parsed.n });
  }

  if (errors.length > 0) return { errors };
  return { valid: { supplyCapList, demandList }, errors: [] };
}

/**
 * 在给定管段容量下计算总获配量（单源单汇最大流）。
 * 与 verifyCapacity 使用完全相同的建模（无向管段双向共享容量、
 * 源点弧为供给上限、汇点弧为出口需求），仅取最大流值，供增容枚举反复调用。
 * 纯函数，不修改输入。
 */
function computeTotalAllocated(
  network: Network,
  supplyCapList: { supply: string; cap: number }[],
  demandList: { outlet: string; demand: number }[],
  edges: ActiveEdge[],
  pipeCapacity: (edge: ActiveEdge) => number
): number {
  const indexOf = new Map<string, number>();
  network.nodes.forEach((node, i) => indexOf.set(node, i));

  const dinic = new CapacityDinic(network.nodes.length);
  const S = dinic.source;
  const T = dinic.sink;

  for (const { supply, cap } of supplyCapList) {
    dinic.addArc(S, indexOf.get(supply)!, cap);
  }
  for (const e of edges) {
    const u = indexOf.get(e.from)!;
    const v = indexOf.get(e.to)!;
    dinic.addUndirectedShared(u, v, pipeCapacity(e));
  }
  for (const { outlet, demand } of demandList) {
    dinic.addArc(indexOf.get(outlet)!, T, demand);
  }

  return dinic.maxFlow(S, T);
}

/**
 * 供水能力核验：在当前阀门开闭状态下，按各供水点供给上限、各保供出口需求量，
 * 求「总供给最大分配」（单源单汇最大流），给出每个出口的获配量与缺口，
 * 并给出一组限制总供给的最小割项目（供给上限 / 连通管段 / 出口需求）。
 *
 * 建模：
 * - 超级源点 → 供水点：容量为该供水点的供给上限；
 * - 每条无阀管段与当前开启的带阀管段：双向共享容量 1 的无向边，
 *   同一管段双向合计只能占用一次，已关阀不参与；
 * - 出口 → 超级汇点：容量为该出口的需求量。
 * 多供水点上限与多出口需求经最大流同时约束。最小割中饱和跨越的弧即瓶颈项目。
 * 纯函数，不修改输入。
 */
export function verifyCapacity(network: Network, query: CapacityQuery): CapacityResult {
  const { valid, errors } = validateCapacityQuery(network, query);
  if (!valid) return { status: 'invalid', errors };
  const { supplyCapList, demandList } = valid;

  const edges = collectActiveEdges(network);
  const indexOf = new Map<string, number>();
  network.nodes.forEach((node, i) => indexOf.set(node, i));

  const dinic = new CapacityDinic(network.nodes.length);
  const S = dinic.source;
  const T = dinic.sink;

  // 记录每条瓶颈候选弧，供最小割项目归集
  const supplyArcIndex = new Map<number, { supply: string; cap: number }>();
  for (const { supply, cap } of supplyCapList) {
    const u = indexOf.get(supply)!;
    const arc = dinic.addArc(S, u, cap);
    supplyArcIndex.set(arc, { supply, cap });
  }

  interface PipeArc {
    id: string;
    fwdArc: number;
  }
  const pipeArcs: PipeArc[] = [];
  for (const e of edges) {
    const u = indexOf.get(e.from)!;
    const v = indexOf.get(e.to)!;
    const fwdArc = dinic.addUndirectedShared(u, v, 1);
    pipeArcs.push({ id: e.id, fwdArc });
  }

  const demandArcIndex = new Map<number, { outlet: string; demand: number }>();
  for (const { outlet, demand } of demandList) {
    const v = indexOf.get(outlet)!;
    const arc = dinic.addArc(v, T, demand);
    demandArcIndex.set(arc, { outlet, demand });
  }

  const totalAllocated = dinic.maxFlow(S, T);
  const inSourceSide = dinic.sourceSideCut(S);

  // 各供水点实际供出量 = 其源点弧上的流量
  const supplyRows: CapacitySupplyRow[] = supplyCapList.map(({ supply, cap }) => {
    let used = 0;
    for (const [arc, info] of supplyArcIndex) {
      if (info.supply === supply) used += dinic.arcFlow(arc);
    }
    return { supply, cap, used };
  });

  // 各出口获配量 = 其汇点弧上的流量
  const outletFlow = new Map<string, number>();
  for (const [arc, info] of demandArcIndex) {
    outletFlow.set(info.outlet, dinic.arcFlow(arc));
  }

  const rows: CapacityOutletRow[] = demandList.map(({ outlet, demand }) => {
    const allocated = outletFlow.get(outlet) ?? 0;
    return {
      outlet,
      demand,
      allocated,
      shortfall: demand - allocated,
      fullySupplied: allocated >= demand,
    };
  });

  // 最小割项目：饱和跨越源侧→汇侧的弧（容量为 0 的弧恒饱和但不构成实际限制，排除）
  const isCrossing = (arc: number): boolean =>
    inSourceSide[dinic.arcFrom(arc)] &&
    !inSourceSide[dinic.arcTo(arc)] &&
    dinic.residualCap(arc) === 0 &&
    dinic.initialArcCap(arc) > 0;

  const cutItems: CapacityCutItem[] = [];
  for (const [arc, info] of supplyArcIndex) {
    if (isCrossing(arc)) {
      cutItems.push({ kind: 'supply', id: info.supply, capacity: info.cap });
    }
  }
  for (const pa of pipeArcs) {
    // 无向共享边：任一方向弧饱和跨越割线即该管段受限（两弧至多一条满足）
    if (isCrossing(pa.fwdArc) || isCrossing(pa.fwdArc ^ 1)) {
      cutItems.push({ kind: 'pipe', id: pa.id, capacity: 1 });
    }
  }
  for (const [arc, info] of demandArcIndex) {
    if (isCrossing(arc)) {
      cutItems.push({ kind: 'demand', id: info.outlet, capacity: info.demand });
    }
  }
  // 排序：类型固定顺序（供给→管段→需求），同类按名称/编号，便于阅读与对照
  const kindOrder: Record<CapacityCutKind, number> = { supply: 0, pipe: 1, demand: 2 };
  cutItems.sort((a, b) => {
    if (kindOrder[a.kind] !== kindOrder[b.kind]) return kindOrder[a.kind] - kindOrder[b.kind];
    return a.id.localeCompare(b.id, 'zh-Hans-CN');
  });

  const totalSupplyCap = supplyCapList.reduce((sum, x) => sum + x.cap, 0);
  const totalDemand = demandList.reduce((sum, x) => sum + x.demand, 0);
  const cutCapacity = cutItems.reduce((sum, x) => sum + x.capacity, 0);

  return {
    status: 'ok',
    activePipeCount: edges.length,
    totalSupplyCap,
    totalDemand,
    totalAllocated,
    totalShortfall: totalDemand - totalAllocated,
    supplyRows,
    rows,
    cutItems,
    cutCapacity,
  };
}

/**
 * 重点出口优先配水：沿用供水能力核验的全部建模（当前阀门状态、供给上限、出口需求、
 * 无向管段双向共享容量 1），做两级字典序最大化：
 *   1. 先使「重点出口」总获配量最大；
 *   2. 再在不减少该值的前提下，使全部出口总获配量最大。
 *
 * 实现为同一网络上的两阶段连续增广：
 * - 第一阶段：网络中只挂「重点出口 → 汇点」的需求弧（普通出口不接汇点），
 *   求一次最大流，其值即重点出口能拿到的最大总量；
 * - 第二阶段：在第一阶段的残量网络上补挂「普通出口 → 汇点」需求弧，再求一次
 *   最大流继续增广。残量网络保留了第一阶段全部已分配流量及其反向回退弧，
 *   因此第二阶段的增广路可以穿过重点出口附近的反向弧、把第一阶段占用的管段
 *   「改派」给其他路径（即允许重新调度已有流量），避免逐出口贪心占管造成的
 *   虚假缺口。增广路始终终于某条出口汇点弧，且第二阶段不存在从源点经重点出口
 *   汇点弧到达汇点的增广路（否则与第一阶段已达重点最大流矛盾），故重点出口
 *   各汇点弧上的流量在第二阶段保持不变，第一级目标值必然不减少。
 * 当没有任何重点出口时，第一阶段值为 0，第二阶段即普通核验的最大流，
 * 总获配量与 verifyCapacity 完全一致。纯函数，不修改输入。
 */
export function verifyPriorityCapacity(network: Network, query: CapacityQuery): PriorityCapacityResult {
  const { valid, errors } = validateCapacityQuery(network, query);
  if (!valid) return { status: 'invalid', errors };
  const { supplyCapList, demandList } = valid;

  // 重点出口名单校验：必须是字符串数组，且每个重点出口都在保供出口名单内
  const priorityErrors: string[] = [];
  const rawPriority = query.priorityOutlets;
  if (rawPriority !== undefined && !asStringArray(rawPriority)) {
    priorityErrors.push('重点出口名单必须是字符串数组。');
  }
  const outletSet = new Set(demandList.map((d) => d.outlet));
  const priorityOutlets: string[] = [];
  if (Array.isArray(rawPriority)) {
    for (const o of uniquePreservingOrder(rawPriority)) {
      if (!outletSet.has(o)) {
        priorityErrors.push(`重点出口「${o}」不在保供出口名单中，请先在保供出口中填写并勾选重点。`);
      } else {
        priorityOutlets.push(o);
      }
    }
  }
  if (priorityErrors.length > 0) return { status: 'invalid', errors: priorityErrors };

  const prioritySet = new Set(priorityOutlets);

  const edges = collectActiveEdges(network);
  const indexOf = new Map<string, number>();
  network.nodes.forEach((node, i) => indexOf.set(node, i));

  const dinic = new CapacityDinic(network.nodes.length);
  const S = dinic.source;
  const T = dinic.sink;

  for (const { supply, cap } of supplyCapList) {
    dinic.addArc(S, indexOf.get(supply)!, cap);
  }
  for (const e of edges) {
    const u = indexOf.get(e.from)!;
    const v = indexOf.get(e.to)!;
    dinic.addUndirectedShared(u, v, 1);
  }

  // 第一阶段：只挂重点出口汇点弧，使重点总获配最大
  const priorityArcIndex = new Map<number, string>();
  for (const { outlet, demand } of demandList) {
    if (!prioritySet.has(outlet)) continue;
    const arc = dinic.addArc(indexOf.get(outlet)!, T, demand);
    priorityArcIndex.set(arc, outlet);
  }
  const priorityAllocated = dinic.maxFlow(S, T);

  // 第二阶段：在同一残量网络上补挂普通出口汇点弧继续增广（允许改派第一阶段流量）
  const normalArcIndex = new Map<number, string>();
  for (const { outlet, demand } of demandList) {
    if (prioritySet.has(outlet)) continue;
    const arc = dinic.addArc(indexOf.get(outlet)!, T, demand);
    normalArcIndex.set(arc, outlet);
  }
  const secondStageGain = dinic.maxFlow(S, T);
  const totalAllocated = priorityAllocated + secondStageGain;

  const allocatedByOutlet = new Map<string, number>();
  for (const [arc, outlet] of priorityArcIndex) {
    allocatedByOutlet.set(outlet, dinic.arcFlow(arc));
  }
  for (const [arc, outlet] of normalArcIndex) {
    allocatedByOutlet.set(outlet, dinic.arcFlow(arc));
  }

  const rows: PriorityCapacityOutletRow[] = demandList.map(({ outlet, demand }) => {
    const allocated = allocatedByOutlet.get(outlet) ?? 0;
    return {
      outlet,
      category: prioritySet.has(outlet) ? 'priority' : 'normal',
      demand,
      allocated,
      shortfall: demand - allocated,
      fullySupplied: allocated >= demand,
    };
  });

  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  const totalSupplyCap = sum(supplyCapList.map((x) => x.cap));
  const totalDemand = sum(demandList.map((x) => x.demand));
  const priorityDemand = sum(demandList.filter((d) => prioritySet.has(d.outlet)).map((d) => d.demand));
  const normalAllocated = sum(
    rows.filter((r) => r.category === 'normal').map((r) => r.allocated)
  );

  return {
    status: 'ok',
    activePipeCount: edges.length,
    priorityOutletCount: priorityOutlets.length,
    totalSupplyCap,
    totalDemand,
    priorityAllocated,
    priorityDemand,
    priorityShortfall: priorityDemand - priorityAllocated,
    totalAllocated,
    normalAllocated,
    totalShortfall: totalDemand - totalAllocated,
    rows,
  };
}

/** 增容方案取舍：总获配量最高 → 改造条数最少 → 管段编号（升序）列表字典序最小。 */
function compareExpansionPlans(a: ExpansionPlan, b: ExpansionPlan): number {  if (a.totalAllocated !== b.totalAllocated) return b.totalAllocated - a.totalAllocated;
  if (a.upgraded.length !== b.upgraded.length) return a.upgraded.length - b.upgraded.length;
  for (let i = 0; i < a.upgraded.length; i++) {
    if (a.upgraded[i] !== b.upgraded[i]) return a.upgraded[i] < b.upgraded[i] ? -1 : 1;
  }
  return 0;
}

/**
 * 管段增容建议：沿用供水能力核验的拓扑、供给上限与出口需求，在当前阀门开闭
 * 状态下，枚举「不改造 / 改造单条 / 改造两条」三种情形——将候选管段容量各由 1
 * 提至 2（最多两条），分别计算总获配量，找出最值得实施的增容方案。
 *
 * - 候选管段为参与输水的不同管段（无阀管段 + 当前开启的带阀管段）；
 *   已关阀与自环不参与输水，自然不可选；
 * - 两条组合与单条、基线一并比较，因此「单条无收益、两条一起才有收益」
 *   （如两条串联瓶颈管段）的情形会被正确识别；
 * - 推荐取舍：总获配量最高 → 改造条数最少 → 管段编号（升序）列表字典序最小；
 *   任何改造都无增益时推荐「不改造」（增量为 0）；
 * - 纯函数，不修改输入拓扑与数值，也不影响供水能力核验的结果。
 */
export function suggestExpansion(network: Network, query: CapacityQuery): ExpansionResult {
  const { valid, errors } = validateCapacityQuery(network, query);
  if (!valid) return { status: 'invalid', errors };
  const { supplyCapList, demandList } = valid;

  // 候选管段：参与输水的不同管段（无阀管段 + 当前开启的带阀管段）；已关阀与自环不可选
  const edges = collectActiveEdges(network);
  const candidateIds = [...new Set(edges.map((e) => e.id))].sort();

  const allocatedWith = (upgraded: ReadonlySet<string>): number =>
    computeTotalAllocated(network, supplyCapList, demandList, edges, (e) =>
      upgraded.has(e.id) ? EXPANSION_TARGET_CAPACITY : 1
    );

  const baseline = allocatedWith(new Set());
  const planOf = (upgraded: string[]): ExpansionPlan => {
    const totalAllocated = allocatedWith(new Set(upgraded));
    return { upgraded, totalAllocated, gain: totalAllocated - baseline };
  };

  // 不改造即初始推荐；任何改造方案只有严格更优（按取舍规则）才会替换它
  let recommended: ExpansionPlan = { upgraded: [], totalAllocated: baseline, gain: 0 };
  let bestSingle: ExpansionPlan | null = null;
  let bestPair: ExpansionPlan | null = null;

  for (const id of candidateIds) {
    const plan = planOf([id]);
    if (!bestSingle || compareExpansionPlans(plan, bestSingle) < 0) bestSingle = plan;
    if (compareExpansionPlans(plan, recommended) < 0) recommended = plan;
  }
  for (let i = 0; i < candidateIds.length; i++) {
    for (let j = i + 1; j < candidateIds.length; j++) {
      const plan = planOf([candidateIds[i], candidateIds[j]]);
      if (!bestPair || compareExpansionPlans(plan, bestPair) < 0) bestPair = plan;
      if (compareExpansionPlans(plan, recommended) < 0) recommended = plan;
    }
  }

  return {
    status: 'ok',
    activePipeCount: candidateIds.length,
    baseline,
    recommended,
    bestSingle,
    bestPair,
  };
}

// ============ 双阀意外关闭风险扫描 ============

/** 参与扫描的当前开启阀门数量上限（单阀 + 双阀场景数为 n + C(n,2)） */
export const MAX_RISK_SCAN_OPEN_VALVES = 20;

/** 一个意外关闭场景：1 或 2 个当前开启阀门同时意外关闭后的总获配情况。 */
export interface ValveClosureScenario {
  /** 意外关闭的阀门编号（升序）；单阀场景 1 个、双阀场景 2 个 */
  closed: string[];
  /** 该场景下的总获配量（与供水能力核验同一模型重算） */
  totalAllocated: number;
  /** 新增缺口 = 基线总获配 - 场景总获配（恒 ≥ 0；仅 > 0 的场景列入结果） */
  newShortfall: number;
  /**
   * 协同失供：双阀场景的新增缺口严格大于两个对应单阀场景新增缺口之和。
   * 单阀场景恒为 false。
   */
  synergistic: boolean;
}

export interface ValveRiskOk {
  status: 'ok';
  /** 参与模拟的当前开启阀门数（已关阀不参与） */
  openValveCount: number;
  /** 基线总获配量（与供水能力核验的总获配一致） */
  baseline: number;
  /** 模拟场景总数 = 单阀场景数 + 双阀场景数 */
  scenarioCount: number;
  /** 全部有损场景：新增缺口降序 → 阀门编号（升序）列表字典序 */
  scenarios: ValveClosureScenario[];
}

export interface ValveRiskInvalid {
  status: 'invalid';
  errors: string[];
}

export type ValveRiskResult = ValveRiskOk | ValveRiskInvalid;

/**
 * 双阀意外关闭风险扫描：沿用供水能力核验的拓扑、供给上限与出口需求，
 * 仅对**当前开启**的阀门模拟「单阀意外关闭」与「两阀同时意外关闭」，
 * 每个场景按同一无向管段共享容量模型（每条参与输水管段容量 1、双向合计占用一次，
 * 已关阀不参与）重算总获配量，与基线（全部保持登记状态）的差值即该场景的新增缺口。
 *
 * - 仅枚举当前开启的阀门，已关阀与无阀管段不作为意外关闭对象；
 *   开启阀门数超过 MAX_RISK_SCAN_OPEN_VALVES 时拒绝扫描（场景数为 n + C(n,2)）；
 * - 双阀场景的新增缺口严格大于两个对应单阀场景新增缺口之和时标记「协同失供」
 *   （两阀互为备份、单独关闭均可绕行，同时关闭才失供的情形）；
 * - 只列出新增缺口 > 0 的有损场景，按「新增缺口降序 → 阀门编号（升序）列表字典序」排列；
 *   无任何有损场景时 scenarios 为空清单；
 * - 纯函数，不修改输入拓扑与登记的阀门开闭状态，也不影响供水能力核验的结果。
 */
export function scanValveClosureRisks(network: Network, query: CapacityQuery): ValveRiskResult {
  const { valid, errors } = validateCapacityQuery(network, query);
  if (!valid) return { status: 'invalid', errors };
  const { supplyCapList, demandList } = valid;

  const openValveIds = network.valvedPipes
    .filter((v) => v.open)
    .map((v) => v.id)
    .sort();
  const n = openValveIds.length;
  if (n > MAX_RISK_SCAN_OPEN_VALVES) {
    return {
      status: 'invalid',
      errors: [
        `当前开启的阀门有 ${n} 个，超过风险扫描上限 ${MAX_RISK_SCAN_OPEN_VALVES} 个；` +
        '请先在输入中将部分阀门标记为关闭（"open": false）后再扫描。',
      ],
    };
  }

  // 意外关闭 = 从参与输水的管段集合中移除对应带阀管段（登记状态不变，仅场景测算）
  const edges = collectActiveEdges(network);
  const allocatedWith = (closedIds: ReadonlySet<string>): number =>
    computeTotalAllocated(
      network,
      supplyCapList,
      demandList,
      edges.filter((e) => !closedIds.has(e.id)),
      () => 1
    );

  const baseline = allocatedWith(new Set());

  // 单阀场景：记录每个阀门单独关闭的新增缺口（含无损的 0），供双阀协同判定使用
  const singleShortfall = new Map<string, number>();
  const scenarios: ValveClosureScenario[] = [];
  for (const id of openValveIds) {
    const totalAllocated = allocatedWith(new Set([id]));
    const newShortfall = baseline - totalAllocated;
    singleShortfall.set(id, newShortfall);
    if (newShortfall > 0) {
      scenarios.push({ closed: [id], totalAllocated, newShortfall, synergistic: false });
    }
  }

  // 双阀场景：新增缺口严格大于两个对应单阀新增缺口之和时标记协同失供
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = openValveIds[i];
      const b = openValveIds[j];
      const totalAllocated = allocatedWith(new Set([a, b]));
      const newShortfall = baseline - totalAllocated;
      if (newShortfall <= 0) continue;
      const synergistic =
        newShortfall > (singleShortfall.get(a) ?? 0) + (singleShortfall.get(b) ?? 0);
      scenarios.push({ closed: [a, b], totalAllocated, newShortfall, synergistic });
    }
  }

  // 展示顺序：新增缺口降序 → 阀门编号（升序）列表字典序（前缀较短者在前）
  scenarios.sort((x, y) => {
    if (x.newShortfall !== y.newShortfall) return y.newShortfall - x.newShortfall;
    const m = Math.min(x.closed.length, y.closed.length);
    for (let i = 0; i < m; i++) {
      if (x.closed[i] !== y.closed[i]) return x.closed[i] < y.closed[i] ? -1 : 1;
    }
    return x.closed.length - y.closed.length;
  });

  return {
    status: 'ok',
    openValveCount: n,
    baseline,
    scenarioCount: n + (n * (n - 1)) / 2,
    scenarios,
  };
}

// ============ 阀门状态异常定位 ============

/** 异常定位最多枚举的阀门状态翻转处数 */
export const MAX_FLIPS = 2;

export interface AnomalyQuery {
  /** 供水点节点 */
  supplies: string[];
  /** 现场观测有水的节点 */
  wetNodes: string[];
  /** 现场观测无水的节点 */
  dryNodes: string[];
}

/** 一个匹配方案中某阀门的开闭状态对照。 */
export interface ValveStateRow {
  /** 阀门编号（带阀管段 id） */
  id: string;
  /** 登记（基线）开闭状态 */
  registeredOpen: boolean;
  /** 翻转后的实际开闭状态（未翻转时与登记一致） */
  actualOpen: boolean;
  /** 该阀门是否被翻转 */
  flipped: boolean;
}

export interface AnomalySolution {
  /** 被翻转的阀门编号（升序）；空数组表示零翻转（登记状态一致） */
  flipped: string[];
  /** 翻转后全部阀门的开闭状态对照（按阀门编号升序） */
  valveStates: ValveStateRow[];
}

export interface AnomalyOk {
  status: 'ok';
  /** 参与枚举的阀门总数（全部带阀管段，开、关状态均可翻转） */
  valveCount: number;
  /** 匹配所需的最少翻转处数（0 表示登记状态与观测一致） */
  minFlips: number;
  /** 翻转数最少的全部匹配方案，按阀门编号升序列表字典序排列 */
  solutions: AnomalySolution[];
  /** 最优方案总数超过展示上限时为 true */
  truncated: boolean;
}

export interface AnomalyNoMatch {
  status: 'no-match';
  valveCount: number;
  reason: string;
}

export interface AnomalyInvalid {
  status: 'invalid';
  errors: string[];
}

export type AnomalyResult = AnomalyOk | AnomalyNoMatch | AnomalyInvalid;

/**
 * 阀门状态异常定位：以登记的各带阀管段开闭状态为基线，枚举最多 MAX_FLIPS 处
 * 状态翻转（开→关或关→开，已关阀也可被翻为开），找出能同时解释全部现场观测的候选。
 *
 * 每个候选按「无阀管段 + 实际开启的带阀管段」计算节点对任一供水点的可达性：
 * 有水观测节点必须可达、无水观测节点必须不可达；只用已观测节点判定匹配，
 * 未观测节点的通水状态不参与判定。
 * 按翻转数 0、1、2 依次枚举，找到匹配即停止，保证翻转数最少；
 * 同一翻转数下组合按阀门编号升序列表字典序生成。纯函数，不修改输入。
 */
export function locateValveAnomalies(network: Network, query: AnomalyQuery): AnomalyResult {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);
  if (query.supplies.length === 0) errors.push('至少需要指定一个供水点。');
  for (const s of query.supplies) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  const supplies = uniquePreservingOrder(query.supplies);
  const wetNodes = uniquePreservingOrder(query.wetNodes);
  const dryNodes = uniquePreservingOrder(query.dryNodes);
  for (const w of wetNodes) {
    if (!nodeSet.has(w)) errors.push(`有水观测节点「${w}」不在节点列表中。`);
  }
  for (const d of dryNodes) {
    if (!nodeSet.has(d)) errors.push(`无水观测节点「${d}」不在节点列表中。`);
  }
  if (wetNodes.length === 0 && dryNodes.length === 0) {
    errors.push('请至少填写一个现场观测节点（有水或无水）。');
  }
  const drySet = new Set(dryNodes);
  for (const w of wetNodes) {
    if (drySet.has(w)) errors.push(`节点「${w}」同时出现在有水与无水观测中，两组观测冲突。`);
  }
  const supplySet = new Set(supplies);
  for (const d of dryNodes) {
    if (supplySet.has(d)) errors.push(`供水点「${d}」本身恒有水，不能登记为无水观测。`);
  }
  if (errors.length > 0) return { status: 'invalid', errors };

  // 候选翻转集合下的通水节点集合：无阀管段全部保留，
  // 带阀管段按「登记状态 XOR 被翻转」得到的实际开闭状态保留
  const reachableWithFlips = (flipped: ReadonlySet<string>): Set<string> => {
    const adj = new Map<string, string[]>();
    const addEdge = (a: string, b: string) => {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a)!.push(b);
    };
    for (const p of network.pipes) {
      addEdge(p.from, p.to);
      addEdge(p.to, p.from);
    }
    for (const vp of network.valvedPipes) {
      const actualOpen = flipped.has(vp.id) ? !vp.open : vp.open;
      if (!actualOpen) continue;
      addEdge(vp.from, vp.to);
      addEdge(vp.to, vp.from);
    }
    const seen = new Set<string>(supplies);
    const queue = [...supplies];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };

  const matches = (flipped: ReadonlySet<string>): boolean => {
    const reachable = reachableWithFlips(flipped);
    return wetNodes.every((n) => reachable.has(n)) && dryNodes.every((n) => !reachable.has(n));
  };

  const makeSolution = (flipped: string[]): AnomalySolution => {
    const flippedSet = new Set(flipped);
    const valveStates: ValveStateRow[] = network.valvedPipes
      .map((vp) => ({
        id: vp.id,
        registeredOpen: vp.open,
        actualOpen: flippedSet.has(vp.id) ? !vp.open : vp.open,
        flipped: flippedSet.has(vp.id),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { flipped: [...flipped].sort(), valveStates };
  };

  const valveIds = network.valvedPipes.map((v) => v.id).sort();
  const n = valveIds.length;

  for (let k = 0; k <= Math.min(MAX_FLIPS, n); k++) {
    const solutions: AnomalySolution[] = [];
    let truncated = false;
    // 字典序生成 k 组合（与关阀方案搜索同一枚举顺序）
    const idx = Array.from({ length: k }, (_, i) => i);
    while (true) {
      const flipped = idx.map((i) => valveIds[i]);
      if (matches(new Set(flipped))) {
        if (solutions.length < MAX_SOLUTIONS) {
          solutions.push(makeSolution(flipped));
        } else {
          truncated = true;
        }
      }
      if (k === 0) break;
      // 下一个组合
      let i = k - 1;
      while (i >= 0 && idx[i] === n - k + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
    if (solutions.length > 0) {
      return { status: 'ok', valveCount: n, minFlips: k, solutions, truncated };
    }
  }
  return {
    status: 'no-match',
    valveCount: n,
    reason:
      `在最多 ${MAX_FLIPS} 处阀门状态翻转内，没有任何候选能同时解释全部现场观测` +
      '（有水节点可达任一供水点、无水节点不可达）。请核对观测记录，' +
      '或考虑三处及以上阀门状态异常、无阀管段破损 / 堵塞等其他原因。',
  };
}

// ============ 单阀异常观测点规划 ============

/** 候选观测节点数上限 */
export const MAX_OBSERVER_CANDIDATES = 12;

export interface ObserverQuery {
  /** 供水点节点 */
  supplies: string[];
  /** 候选观测节点（去重后不得超过 MAX_OBSERVER_CANDIDATES 个） */
  candidates: string[];
}

/** 一个待区分假设：登记状态（零翻转）或单个阀门单独翻转。 */
export interface ObserverHypothesis {
  /** 假设类型：登记状态（零翻转）/ 单个阀门单独翻转 */
  kind: 'baseline' | 'single-flip';
  /** single-flip 时为被翻转的阀门编号；baseline 时为 null */
  flippedValve: string | null;
  /** 该阀门登记（基线）开闭状态；baseline 时为 null */
  registeredOpen: boolean | null;
  /** 该假设下阀门的实际开闭状态；baseline 时为 null */
  actualOpen: boolean | null;
}

/** 不可区分组：组内各假设在全部候选观测节点上的有水 / 无水签名完全相同。 */
export interface ObserverGroup {
  /** 组内全部假设（登记状态优先，其余按阀门编号升序） */
  hypotheses: ObserverHypothesis[];
  /** 该组在各候选节点（名称升序）上的有水 / 无水签名，true 表示有水（可达任一供水点） */
  signature: boolean[];
  /** 该组在推荐观测点上的预期状态，与推荐点一一对应 */
  expectedStates: boolean[];
}

export interface ObserverPlanOk {
  status: 'ok';
  /** 参与枚举的阀门总数（全部带阀管段，开、关状态均可翻转） */
  valveCount: number;
  /** 假设总数（= 阀门数 + 1） */
  hypothesisCount: number;
  /** 候选观测节点（按名称升序） */
  candidates: string[];
  /** 按签名归并出的不可区分组（组按其首个假设的顺序排列） */
  groups: ObserverGroup[];
  /** 是否能仅靠这些候选节点区分任意两组（全部假设同组时为 false） */
  distinguishable: boolean;
  /** 能区分任意两组的最少观测点节点名称（名称升序）；不可区分时为 null */
  recommendedPoints: string[] | null;
  /** 推荐观测点个数；不可区分时为 0 */
  pointCount: number;
}

export interface ObserverInvalid {
  status: 'invalid';
  errors: string[];
}

export type ObserverPlanResult = ObserverPlanOk | ObserverInvalid;

/**
 * 单阀异常观测点规划：沿用拓扑与供水点（不改拓扑），把「登记状态」与「每个阀门
 * 单独翻转」分别作为一个假设（共阀门数 + 1 个），对每个候选观测节点按「无阀管段 +
 * 实际开启的带阀管段」计算其能否连通任一供水点，得到该假设在该节点上的有水 / 无水签名。
 *
 * - 候选节点上签名完全相同的假设归为一个不可区分组并全部列出；
 * - 对不同组搜索能区分任意两组的最少观测点集合：按观测点个数 k = 1, 2, … 枚举，
 *   同数时按「节点名称升序列表」的字典序取首个；全部假设同组时判定无法靠这些节点区分；
 * - 输出各组在推荐观测点上的预期有水 / 无水状态。
 * 纯函数，不修改输入拓扑与登记的阀门状态。
 */
export function planSingleValveObservers(network: Network, query: ObserverQuery): ObserverPlanResult {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);
  if (query.supplies.length === 0) errors.push('至少需要指定一个供水点。');
  for (const s of query.supplies) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  if (!Array.isArray(query.candidates)) {
    errors.push('候选观测节点必须是数组。');
  }
  const rawCandidates = Array.isArray(query.candidates) ? query.candidates : [];
  for (const c of rawCandidates) {
    if (typeof c !== 'string' || c.length === 0) {
      errors.push('候选观测节点必须是非空字符串。');
    } else if (!nodeSet.has(c)) {
      errors.push(`候选观测节点「${c}」不在节点列表中。`);
    }
  }
  if (errors.length > 0) return { status: 'invalid', errors };

  const supplies = uniquePreservingOrder(query.supplies);
  // 去重并按名称升序排列：签名列顺序与同数字典序取舍均以此顺序为准
  const candidates = uniquePreservingOrder(rawCandidates).sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN')
  );
  if (candidates.length === 0) errors.push('请至少填写一个候选观测节点。');
  if (candidates.length > MAX_OBSERVER_CANDIDATES) {
    errors.push(
      `候选观测节点有 ${candidates.length} 个，超过上限 ${MAX_OBSERVER_CANDIDATES} 个；请精简候选名单后再规划。`
    );
  }
  if (errors.length > 0) return { status: 'invalid', errors };

  const valveIds = network.valvedPipes.map((v) => v.id).sort();
  const indexOf = new Map<string, number>();
  network.nodes.forEach((node, i) => indexOf.set(node, i));
  const candidateIdx = candidates.map((c) => indexOf.get(c)!);
  const supplyIdx = new Set(supplies.map((s) => indexOf.get(s)!));

  // 无阀管段邻接（与阀门状态无关，只需构建一次）；带阀管段按假设实际开闭加入
  const baseAdj: number[][] = Array.from({ length: network.nodes.length }, () => []);
  const addEdge = (adj: number[][], a: number, b: number): void => {
    adj[a].push(b);
    adj[b].push(a);
  };
  for (const p of network.pipes) {
    if (p.from === p.to) continue; // 自环对连通无意义
    addEdge(baseAdj, indexOf.get(p.from)!, indexOf.get(p.to)!);
  }

  /** 计算某阀门单独翻转（flippedId 为 null 表示登记状态）下各候选节点是否有水。 */
  const signatureOf = (flippedId: string | null): boolean[] => {
    const adj: number[][] = baseAdj.map((row) => [...row]);
    for (const vp of network.valvedPipes) {
      if (vp.from === vp.to) continue;
      const actualOpen = flippedId !== null && vp.id === flippedId ? !vp.open : vp.open;
      if (!actualOpen) continue;
      addEdge(adj, indexOf.get(vp.from)!, indexOf.get(vp.to)!);
    }
    const seen = new Array<boolean>(network.nodes.length).fill(false);
    const queue: number[] = [];
    for (const s of supplyIdx) {
      if (!seen[s]) {
        seen[s] = true;
        queue.push(s);
      }
    }
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of adj[cur]) {
        if (!seen[next]) {
          seen[next] = true;
          queue.push(next);
        }
      }
    }
    return candidateIdx.map((ci) => seen[ci]);
  };

  // 假设顺序：登记状态优先，其后各阀门按编号升序单独翻转
  const hypotheses: ObserverHypothesis[] = [
    { kind: 'baseline', flippedValve: null, registeredOpen: null, actualOpen: null },
    ...network.valvedPipes
      .map((vp) => ({ id: vp.id, open: vp.open }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((v) => ({
        kind: 'single-flip' as const,
        flippedValve: v.id,
        registeredOpen: v.open,
        actualOpen: !v.open,
      })),
  ];
  // 与 hypotheses 对齐的签名矩阵（每行一个假设）
  const signatures: boolean[][] = [
    signatureOf(null),
    ...valveIds.map((id) => signatureOf(id)),
  ];

  // 按签名归并不可区分组（保持假设首次出现的顺序）
  const groupKeyOf = (sig: boolean[]): string => sig.map((b) => (b ? '1' : '0')).join('');
  const groupIndexByKey = new Map<string, number>();
  const groups: { hypotheses: ObserverHypothesis[]; signature: boolean[] }[] = [];
  signatures.forEach((sig, hi) => {
    const key = groupKeyOf(sig);
    const gi = groupIndexByKey.get(key);
    if (gi === undefined) {
      groupIndexByKey.set(key, groups.length);
      groups.push({ hypotheses: [hypotheses[hi]], signature: sig });
    } else {
      groups[gi].hypotheses.push(hypotheses[hi]);
    }
  });

  if (groups.length === 1) {
    return {
      status: 'ok',
      valveCount: valveIds.length,
      hypothesisCount: hypotheses.length,
      candidates,
      groups: [{ ...groups[0], expectedStates: [] }],
      distinguishable: false,
      recommendedPoints: null,
      pointCount: 0,
    };
  }

  /** 所选候选列能否区分任意两组：等价于每个组在这些列上的签名（位模式）两两不同。 */
  const distinguishesAll = (chosen: number[]): boolean => {
    const seenPatterns = new Set<number>();
    for (const g of groups) {
      let pattern = 0;
      chosen.forEach((ci, bit) => {
        if (g.signature[ci]) pattern |= 1 << bit;
      });
      if (seenPatterns.has(pattern)) return false;
      seenPatterns.add(pattern);
    }
    return true;
  };

  // 按观测点个数 k = 1..m 枚举，同 k 下按候选下标升序（即节点名称升序列表）字典序生成，
  // 首个可区分任意两组的集合即「点数最少 → 名称列表字典序最小」的推荐
  const m = candidates.length;
  let recommended: number[] | null = null;
  for (let k = 1; k <= m && recommended === null; k++) {
    const idx = Array.from({ length: k }, (_, i) => i);
    while (true) {
      if (distinguishesAll(idx)) {
        recommended = [...idx];
        break;
      }
      let i = k - 1;
      while (i >= 0 && idx[i] === m - k + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
  }

  // 不同组在全部候选上签名必不相同，故全部候选一定可区分，recommended 不可能为 null
  const recommendedIdx = recommended!;
  const recommendedPoints = recommendedIdx.map((ci) => candidates[ci]);

  return {
    status: 'ok',
    valveCount: valveIds.length,
    hypothesisCount: hypotheses.length,
    candidates,
    groups: groups.map((g) => ({
      hypotheses: g.hypotheses,
      signature: g.signature,
      expectedStates: recommendedIdx.map((ci) => g.signature[ci]),
    })),
    distinguishable: true,
    recommendedPoints,
    pointCount: recommendedPoints.length,
  };
}
