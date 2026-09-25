import './style.css';
import {
  parseNetwork,
  solve,
  inspectResilience,
  verifyCapacity,
  verifyPriorityCapacity,
  suggestExpansion,
  scanValveClosureRisks,
  locateValveAnomalies,
  planSingleValveObservers,
  MAX_OPEN_VALVES,
  EXPANSION_TARGET_CAPACITY,
  MAX_EXPANSION_PIPES,
  MAX_RISK_SCAN_OPEN_VALVES,
  MAX_FLIPS,
  MAX_OBSERVER_CANDIDATES,
  type Query,
  type CapacityQuery,
  type AnomalyQuery,
  type ObserverQuery,
  type SolveResult,
  type ResilienceResult,
  type CapacityResult,
  type PriorityCapacityResult,
  type ExpansionResult,
  type ExpansionPlan,
  type ValveRiskResult,
  type AnomalyResult,
  type AnomalySolution,
  type ObserverPlanResult,
  type ObserverHypothesis,
} from './solver';
import {
  SAMPLE_NETWORK,
  SAMPLE_QUERY,
  SAMPLE_SUPPLY_CAPS,
  SAMPLE_OUTLET_DEMANDS,
  SAMPLE_PRIORITY_OUTLETS,
  SAMPLE_WET_NODES,
  SAMPLE_DRY_NODES,
  SAMPLE_OBSERVER_CANDIDATES,
} from './sample';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <header>
    <h1>展馆水路检修隔离方案搜索</h1>
    <p class="subtitle">
      粘贴管网拓扑 JSON，指定供水点、漏点与保供出口，可自动搜索最优关阀组合，
      也可对各保供出口做「保供韧性巡检」（按当前阀门开闭状态估算使其断水至少需失效的管段数），
      还可做「供水能力核验」（按供给上限与出口需求量求总供给最大分配、缺口与限制总供给的最小割），
      可将部分保供出口标为「重点」做「重点出口优先配水」（先让重点出口总获配最大，再在此前提下让全部出口总获配最大），
      并能给出「管段增容建议」（在当前阀门状态下枚举将参与输水管段容量由 1 提至 2 的改造方案，最多改造两条）。
      还可做「双阀意外关闭风险扫描」（仅对当前开启阀门模拟单阀或两阀意外关闭，最多 ${MAX_RISK_SCAN_OPEN_VALVES} 个开启阀门，
      按同一共享容量模型重算各场景总获配，以比基线减少的数值作为新增缺口，双阀缺口严格大于两个单阀缺口之和时标记协同失供）。
      还可根据现场有水 / 无水观测做「阀门状态异常定位」（以登记的阀门开闭状态为基线，枚举最多 ${MAX_FLIPS} 处状态翻转来解释全部观测），
      并能做「单阀异常观测点规划」（把登记状态与每个阀门单独翻转作为假设，按候选观测节点的有水 / 无水签名归并不可区分组，
      并搜索能区分任意两组的最少观测点集合，最多填 ${MAX_OBSERVER_CANDIDATES} 个候选节点）。
      组合搜索最多覆盖 ${MAX_OPEN_VALVES} 个当前开启的阀门；求解过程不修改输入中的阀门状态。
    </p>
  </header>
  <main>
    <section class="panel input-panel">
      <div class="panel-title">
        <h2>1. 管网拓扑 JSON</h2>
        <button id="load-sample" type="button">载入示例拓扑</button>
      </div>
      <textarea id="topology" spellcheck="false" placeholder='{"nodes":[...],"pipes":[...],"valvedPipes":[...]}'></textarea>
      <h2>2. 检修条件</h2>
      <div class="fields">
        <label>
          供水点（多个用逗号分隔）
          <input id="supplies" type="text" placeholder="如：市政供水S1, 备用水箱S2" />
        </label>
        <label>
          漏点
          <input id="leak" type="text" placeholder="如：环管N2" />
        </label>
        <label>
          保供出口（多个用逗号分隔）
          <input id="outlets" type="text" placeholder="如：展厅B, 咖啡厅" />
        </label>
      </div>
      <div class="button-row">
        <button id="solve" type="button" class="primary">搜索关阀方案</button>
        <button id="inspect" type="button" class="secondary">保供韧性巡检</button>
      </div>
      <p class="hint">
        巡检沿用上方「供水点」与「保供出口」：无阀管段与开启的带阀管段均按单条失效计，
        已关阀不参与；多供水点作为整体，环路及并行管段分别计数。
      </p>
      <h2>3. 供水能力核验、重点优先配水、管段增容与双阀风险扫描</h2>
      <p class="hint">
        为每个供水点填写非负整数<strong>供给上限</strong>、为每个保供出口填写非负整数<strong>需求量</strong>，
        并为每个保供出口选择<strong>重点 / 普通</strong>（默认普通），按当前阀门开闭状态求总供给最大分配
        （每条连通管段容量为 1、同一无向管段双向合计只能占用一次，已关阀不参与）。留空数值按 0 处理。
      </p>
      <button id="build-capacity-form" type="button">按上方供水点 / 保供出口生成填写表</button>
      <div id="capacity-form" class="capacity-form">
        <p class="hint">尚未生成填写表：点击上方按钮后，为各供水点和保供出口填写数值、选择重点出口，再点核验按钮。</p>
      </div>
      <div class="button-row">
        <button id="verify-capacity" type="button" class="secondary">核验供水能力</button>
        <button id="priority-capacity" type="button" class="secondary">重点出口优先配水</button>
        <button id="suggest-expansion" type="button" class="secondary">管段增容建议</button>
        <button id="scan-valve-risks" type="button" class="secondary">双阀意外关闭风险扫描</button>
      </div>
      <p class="hint">
        「重点出口优先配水」分两级目标：先使<strong>重点出口</strong>总获配量最大，再在<strong>不减少该值</strong>的前提下
        使全部出口总获配量最大；第二阶段在残量网络上继续增广，可<strong>改派已分配流量</strong>，不会逐出口占管造成虚假缺口。
        未勾选任何重点出口时，结果与「核验供水能力」的总获配量一致。
      </p>
      <p class="hint">
        增容建议沿用本页拓扑与上方填写的供给上限 / 需求量：仅将参与输水的不同管段（无阀管段或开启阀门）
        容量各由 1 提至 ${EXPANSION_TARGET_CAPACITY}，最多改造 ${MAX_EXPANSION_PIPES} 条；
        已关阀及自环不可选。分别计算不改造、单条与两条组合的总获配量，按
        「总获配量最高 → 改造条数最少 → 管段编号列表字典序最小」推荐方案。
      </p>
      <p class="hint">
        「双阀意外关闭风险扫描」沿用同一份拓扑、登记阀门状态与填写表数值：仅对<strong>当前开启</strong>的阀门
        （最多 ${MAX_RISK_SCAN_OPEN_VALVES} 个）模拟<strong>单阀或两阀意外关闭</strong>，按同一共享容量模型重算各场景总获配量，
        以比基线减少的数值作为<strong>新增缺口</strong>，按「新增缺口降序 → 阀门编号列表字典序」展示全部有损场景；
        双阀新增缺口严格大于两个对应单阀新增缺口之和时标记<strong>协同失供</strong>。扫描仅做场景测算，不改登记状态。
      </p>
      <h2>4. 阀门状态异常定位</h2>
      <p class="hint">
        沿用上方拓扑与供水点：把现场观测到的<strong>有水</strong> / <strong>无水</strong>节点分别填入，
        以登记的各带阀管段开闭状态为基线，枚举最多 ${MAX_FLIPS} 处状态翻转（开↔关，已关阀也可被翻为开），
        找出能同时解释全部观测的候选——有水节点须可达任一供水点、无水节点须不可达；只用已观测节点判定匹配。
      </p>
      <div class="fields">
        <label>
          现场有水节点（多个用逗号分隔）
          <input id="wet-nodes" type="text" placeholder="如：咖啡厅, 卫生间" />
        </label>
        <label>
          现场无水节点（多个用逗号分隔）
          <input id="dry-nodes" type="text" placeholder="如：展厅B" />
        </label>
      </div>
      <div class="button-row">
        <button id="locate-anomaly" type="button" class="secondary">定位异常阀门</button>
      </div>
      <h2>5. 单阀异常观测点规划</h2>
      <p class="hint">
        沿用上方拓扑与供水点：填写<strong>最多 ${MAX_OBSERVER_CANDIDATES} 个候选观测节点</strong>，
        把「登记状态」与「每个阀门单独翻转」分别作为假设，按各候选节点能否连通任一供水点生成<strong>有水 / 无水签名</strong>。
        签名相同的假设归为<strong>不可区分组</strong>并列出；再搜索能区分任意两组的<strong>最少观测点集合</strong>
        （同数时按节点名称升序列表的字典序推荐），并展示各组在推荐点的预期状态。求解不改拓扑。
      </p>
      <div class="fields">
        <label>
          候选观测节点（多个用逗号分隔，最多 ${MAX_OBSERVER_CANDIDATES} 个）
          <input id="observer-candidates" type="text" placeholder="如：展厅A, 展厅B, 卫生间" />
        </label>
      </div>
      <div class="button-row">
        <button id="plan-observers" type="button" class="secondary">规划观测点</button>
      </div>
    </section>
    <div class="side-column">
      <section class="panel result-panel">
        <h2>关阀方案搜索结果</h2>
        <div id="result"><p class="hint">尚未求解。可点击「载入示例拓扑」快速体验。</p></div>
      </section>
      <section class="panel result-panel">
        <h2>保供韧性巡检</h2>
        <div id="inspect-result">
          <p class="hint">
            点击「保供韧性巡检」后，这里按「使其失去全部供水至少需失效的不同管段数」升序列出各出口，
            并给出一组达到该数量的管段编号，供安排巡检。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>供水能力核验</h2>
        <div id="capacity-result">
          <p class="hint">
            点击「核验供水能力」后，这里展示总供给最大分配、每个出口的获配量与缺口，
            以及一组限制总供给的最小割项目（供给上限、管段或出口需求）。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>重点出口优先配水</h2>
        <div id="priority-result">
          <p class="hint">
            在填写表中将部分保供出口选为「重点」后点击「重点出口优先配水」，这里先展示第一级目标值
            （重点出口总获配量），再展示第二级目标值（不减少重点获配前提下的全部出口总获配量），
            并列出每个出口的类别、获配量与缺口，供与「供水能力核验」对照。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>管段增容建议</h2>
        <div id="expansion-result">
          <p class="hint">
            点击「管段增容建议」后，这里对比不改造、单条与两条组合改造的总获配量，
            推荐总获配量最高、改造条数最少、管段编号字典序最小的方案；零增量时提示无需增容。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>双阀意外关闭风险扫描</h2>
        <div id="risk-result">
          <p class="hint">
            点击「双阀意外关闭风险扫描」后，这里按「新增缺口降序 → 阀门编号列表字典序」列出全部有损场景
            （单阀 / 双阀意外关闭后的总获配量与新增缺口）；双阀新增缺口严格大于两个对应单阀之和时标记「协同失供」；
            无有损场景时会明确提示。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>阀门状态异常定位</h2>
        <div id="anomaly-result">
          <p class="hint">
            在左侧填写现场有水 / 无水观测节点后点击「定位异常阀门」，这里列出翻转数最少的全部匹配方案
            （被翻转的阀门及翻转后的开闭状态）；零翻转表示登记状态与现场一致，无匹配表示两处以内无法解释。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>单阀异常观测点规划</h2>
        <div id="observer-result">
          <p class="hint">
            在左侧填写候选观测节点后点击「规划观测点」，这里列出登记状态与每个阀门单独翻转等假设的
            不可区分分组，给出能区分任意两组的最少观测点集合（同数按节点名称升序列表字典序推荐），
            并展示各组在推荐点的预期有水 / 无水状态；全部假设同组时说明无法靠这些节点区分。
          </p>
        </div>
      </section>
    </div>
  </main>
`;

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`缺少元素 ${selector}`);
  return node;
}

const topologyEl = el<HTMLTextAreaElement>('#topology');
const suppliesEl = el<HTMLInputElement>('#supplies');
const leakEl = el<HTMLInputElement>('#leak');
const outletsEl = el<HTMLInputElement>('#outlets');
const wetNodesEl = el<HTMLInputElement>('#wet-nodes');
const dryNodesEl = el<HTMLInputElement>('#dry-nodes');
const observerCandidatesEl = el<HTMLInputElement>('#observer-candidates');
const resultEl = el<HTMLDivElement>('#result');
const inspectResultEl = el<HTMLDivElement>('#inspect-result');
const capacityFormEl = el<HTMLDivElement>('#capacity-form');
const capacityResultEl = el<HTMLDivElement>('#capacity-result');
const priorityResultEl = el<HTMLDivElement>('#priority-result');
const expansionResultEl = el<HTMLDivElement>('#expansion-result');
const riskResultEl = el<HTMLDivElement>('#risk-result');
const anomalyResultEl = el<HTMLDivElement>('#anomaly-result');
const observerResultEl = el<HTMLDivElement>('#observer-result');

/** 已生成填写表对应的供水点 / 保供出口。 */
interface CapacityFormState {
  supplies: string[];
  outlets: string[];
}
let capacityFormState: CapacityFormState | null = null;

function splitList(text: string): string[] {
  return text
    .split(/[,，;；\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]!));
}

function renderErrors(target: HTMLElement, title: string, errors: string[]): void {
  target.innerHTML = `
    <div class="banner error">${escapeHtml(title)}</div>
    <ul class="error-list">
      ${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}
    </ul>`;
}

function renderResult(result: SolveResult, query: Query): void {
  if (result.status === 'invalid') {
    renderErrors(resultEl, '输入有误，无法求解：', result.errors);
    return;
  }
  if (result.status === 'no-solution') {
    resultEl.innerHTML = `
      <div class="banner error">无解：当前条件下不存在满足要求的关阀组合。</div>
      <p>${escapeHtml(result.reason)}</p>
      <p class="hint">参与搜索的开启阀门数：${result.openValveCount}</p>`;
    return;
  }

  const best = result.solutions[0];
  const rows = (sol: typeof best) =>
    sol.outletStatus
      .map(
        (o) => `
        <tr>
          <td>${escapeHtml(o.outlet)}</td>
          <td class="${o.connected ? 'ok' : 'bad'}">${o.connected ? '✓ 正常供水' : '✗ 断水'}</td>
          <td>${o.reachableSupplies.map(escapeHtml).join('、') || '—'}</td>
        </tr>`
      )
      .join('');

  resultEl.innerHTML = `
    <div class="banner success">
      找到 ${result.solutions.length}${result.truncated ? '+' : ''} 个最优方案：
      最少需关闭 <strong>${result.minClosed}</strong> 个阀门。
      推荐方案（同数按阀门编号字典序最小）：关闭
      ${best.closed.length > 0 ? best.closed.map((v) => `<code>${escapeHtml(v)}</code>`).join('、') : '（无需关阀）'}
    </div>
    <p class="hint">
      参与搜索的当前开启阀门数：${result.openValveCount}；
      漏点「${escapeHtml(query.leak)}」在所有方案中均已与全部供水点断开；
      输入 JSON 中的阀门开闭状态不会被修改。
    </p>
    ${result.solutions
      .map(
        (sol, i) => `
      <details class="solution" ${i === 0 ? 'open' : ''}>
        <summary>
          方案 ${i + 1}：关闭 ${sol.closed.length} 个阀门
          ${sol.closed.length > 0 ? `（${sol.closed.map(escapeHtml).join('、')}）` : ''}
        </summary>
        <table>
          <thead>
            <tr><th>保供出口</th><th>连通状态</th><th>可达供水点</th></tr>
          </thead>
          <tbody>${rows(sol)}</tbody>
        </table>
      </details>`
      )
      .join('')}
    ${result.truncated ? '<p class="hint">最优方案过多，仅展示前 100 个。</p>' : ''}`;
}

function renderInspection(result: ResilienceResult): void {
  if (result.status === 'invalid') {
    renderErrors(inspectResultEl, '输入有误，无法巡检：', result.errors);
    return;
  }

  const rows = result.rows.map((row) => {
    if (!row.assessable) {
      return `
        <tr>
          <td>${escapeHtml(row.outlet)}</td>
          <td><span class="tag tag-skip">无法评估</span></td>
          <td class="num">—</td>
          <td>${escapeHtml(row.reason)}</td>
        </tr>`;
    }
    const tag = row.alreadyCut
      ? '<span class="tag tag-cut">已断水</span>'
      : row.minFailures === 1
        ? '<span class="tag tag-low">薄弱</span>'
        : '<span class="tag tag-ok">有韧性</span>';
    const pipes =
      row.witnessPipes.length > 0
        ? row.witnessPipes.map((p) => `<code>${escapeHtml(p)}</code>`).join('、')
        : '<span class="hint">（空清单）</span>';
    return `
      <tr>
        <td>${escapeHtml(row.outlet)}</td>
        <td>${tag}</td>
        <td class="num"><strong>${row.minFailures}</strong></td>
        <td>${pipes}</td>
      </tr>`;
  });

  inspectResultEl.innerHTML = `
    <div class="banner success">
      巡检完成：共评估 ${result.rows.length} 个保供出口，参与计数的管段
      （无阀管段 + 当前开启的带阀管段）共 <strong>${result.activePipeCount}</strong> 条；
      已关阀不参与。结果已按所需失效数升序排列。
    </div>
    <table>
      <thead>
        <tr><th>保供出口</th><th>状态</th><th>至少需失效管段数</th><th>一组达到该数量的管段（巡检清单）</th></tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <p class="hint">
      数值表示：在当前阀门开闭状态下，使该出口与全部供水点断开，至少需要同时失效多少条不同管段
      （多供水点作为整体；环路及并行管段分别计数）。已断水出口显示 0 与空清单；
      出口与供水点同名时无法按管段失效评估。数值越小越应优先巡检，右侧管段为一组最薄弱环节。
    </p>`;
}

/** 渲染供水能力核验的数值填写表（保留已有同值输入与重点选择）。 */
function buildCapacityForm(
  supplies: string[],
  outlets: string[],
  prevCaps?: Record<string, number>,
  prevDemands?: Record<string, number>,
  prevPriority?: ReadonlySet<string>
): void {
  const valueOr = (map: Record<string, number> | undefined, key: string): string => {
    if (!map) return '';
    const v = map[key];
    return v === undefined ? '' : String(v);
  };
  const supplyInputs = supplies
    .map(
      (s) => `
        <label class="cap-row">
          <span>${escapeHtml(s)}</span>
          <input
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            data-supply="${escapeHtml(s)}"
            value="${valueOr(prevCaps, s)}"
            placeholder="供给上限"
          />
        </label>`
    )
    .join('');
  const outletInputs = outlets
    .map((o) => {
      const isPriority = prevPriority?.has(o) ?? false;
      return `
        <label class="cap-row cap-row-outlet">
          <span>${escapeHtml(o)}</span>
          <input
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            data-outlet="${escapeHtml(o)}"
            value="${valueOr(prevDemands, o)}"
            placeholder="需求量"
          />
          <select data-priority="${escapeHtml(o)}" aria-label="保供出口 ${escapeHtml(o)} 的重点 / 普通类别">
            <option value="normal"${isPriority ? '' : ' selected'}>普通</option>
            <option value="priority"${isPriority ? ' selected' : ''}>重点</option>
          </select>
        </label>`;
    })
    .join('');
  capacityFormEl.innerHTML = `
    <div class="cap-grid">
      <div>
        <h3>供水点供给上限</h3>
        ${supplies.length > 0 ? supplyInputs : '<p class="hint">请先在上方填写至少一个供水点。</p>'}
      </div>
      <div>
        <h3>保供出口需求量与类别</h3>
        ${outlets.length > 0 ? outletInputs : '<p class="hint">请先在上方填写至少一个保供出口。</p>'}
        ${outlets.length > 0 ? '<p class="hint">类别默认为「普通」；选为「重点」的出口在「重点出口优先配水」中优先获得分配。</p>' : ''}
      </div>
    </div>`;
  capacityFormState = { supplies, outlets };
}

/** 读取填写表中的非负整数与重点出口选择；返回错误信息列表（空串与纯空白按 0）。 */
function readCapacityNumbers(): {
  supplyCaps: Record<string, number>;
  outletDemands: Record<string, number>;
  priorityOutlets: string[];
  errors: string[];
} {
  const supplyCaps: Record<string, number> = {};
  const outletDemands: Record<string, number> = {};
  const priorityOutlets: string[] = [];
  const errors: string[] = [];
  if (!capacityFormState) {
    return { supplyCaps, outletDemands, priorityOutlets, errors: ['请先生成供水能力填写表。'] };
  }

  const parseInput = (input: HTMLInputElement): number | null => {
    const isSupply = input.dataset.supply !== undefined;
    const name = isSupply ? input.dataset.supply! : input.dataset.outlet!;
    const fieldLabel = isSupply ? '供给上限' : '需求量';
    const ownerLabel = isSupply ? '供水点' : '保供出口';
    const text = input.value.trim();
    if (text === '') return 0;
    if (!/^\d+$/.test(text)) {
      errors.push(`${ownerLabel}「${name}」的${fieldLabel}必须是非负整数。`);
      return null;
    }
    const n = Number(text);
    if (!Number.isSafeInteger(n)) {
      errors.push(`${ownerLabel}「${name}」的${fieldLabel}数值过大。`);
      return null;
    }
    return n;
  };

  capacityFormEl.querySelectorAll<HTMLInputElement>('input[data-supply]').forEach((input) => {
    const n = parseInput(input);
    if (n !== null) supplyCaps[input.dataset.supply!] = n;
  });
  capacityFormEl.querySelectorAll<HTMLInputElement>('input[data-outlet]').forEach((input) => {
    const n = parseInput(input);
    if (n !== null) outletDemands[input.dataset.outlet!] = n;
  });
  capacityFormEl.querySelectorAll<HTMLSelectElement>('select[data-priority]').forEach((select) => {
    if (select.value === 'priority') priorityOutlets.push(select.dataset.priority!);
  });
  return { supplyCaps, outletDemands, priorityOutlets, errors };
}

const CUT_KIND_LABEL: Record<import('./solver').CapacityCutKind, string> = {
  supply: '供给上限',
  pipe: '管段',
  demand: '出口需求',
};

function renderCapacity(result: CapacityResult): void {
  if (result.status === 'invalid') {
    renderErrors(capacityResultEl, '输入有误，无法核验：', result.errors);
    return;
  }

  const outletRows = result.rows
    .map(
      (o) => `
      <tr>
        <td>${escapeHtml(o.outlet)}</td>
        <td class="num">${o.demand}</td>
        <td class="num"><strong>${o.allocated}</strong></td>
        <td class="num ${o.shortfall > 0 ? 'bad' : 'ok'}">${o.shortfall}</td>
        <td>${o.fullySupplied ? '<span class="tag tag-ok">足额</span>' : '<span class="tag tag-cut">缺口</span>'}</td>
      </tr>`
    )
    .join('');

  const supplyRows = result.supplyRows
    .map(
      (s) => `
      <tr>
        <td>${escapeHtml(s.supply)}</td>
        <td class="num">${s.cap}</td>
        <td class="num">${s.used}</td>
        <td class="num ${s.used >= s.cap && s.cap > 0 ? 'bad' : ''}">${s.cap - s.used}</td>
      </tr>`
    )
    .join('');

  const cutList =
    result.cutItems.length > 0
      ? `<ul class="cut-list">
          ${result.cutItems
            .map(
              (c) => `
            <li>
              <span class="tag tag-kind tag-${c.kind}">${CUT_KIND_LABEL[c.kind]}</span>
              <code>${escapeHtml(c.id)}</code>
              <span class="hint">限制容量 ${c.capacity}</span>
            </li>`
            )
            .join('')}
        </ul>
        <p class="hint">上述项目容量合计 <strong>${result.cutCapacity}</strong>，恰等于总获配量（最大流 = 最小割）。</p>`
      : '<p class="hint">总获配量为 0，不存在容量为正的限制项（当前阀门状态下供水点与出口完全不通，或供给上限/需求量均为 0）。</p>';

  const bannerClass = result.totalShortfall > 0 ? 'warn' : 'success';
  const banner =
    result.totalShortfall > 0
      ? `总供给最大分配 <strong>${result.totalAllocated}</strong> / 总需求 ${result.totalDemand}，
         总缺口 <strong>${result.totalShortfall}</strong>：当前供水能力无法足额满足全部出口。`
      : `总供给最大分配 <strong>${result.totalAllocated}</strong>，全部出口需求均已足额满足
         （总供给上限 ${result.totalSupplyCap}，总需求 ${result.totalDemand}）。`;

  capacityResultEl.innerHTML = `
    <div class="banner ${bannerClass}">${banner}</div>
    <table>
      <thead>
        <tr><th>保供出口</th><th>需求量</th><th>获配量</th><th>缺口</th><th>状态</th></tr>
      </thead>
      <tbody>${outletRows}</tbody>
    </table>
    <details>
      <summary>各供水点供出情况（上限 / 已供 / 富余）</summary>
      <table>
        <thead>
          <tr><th>供水点</th><th>供给上限</th><th>已供出</th><th>富余</th></tr>
        </thead>
        <tbody>${supplyRows}</tbody>
      </table>
    </details>
    <h3>一组限制总供给的最小割项目</h3>
    ${cutList}
    <p class="hint">
      参与输水的管段（无阀管段 + 当前开启的带阀管段）共 ${result.activePipeCount} 条，
      每条容量为 1；同一无向管段双向合计只能占用一次，已关阀不参与。
      最小割项目可能是某个供水点的供给上限、某条管段或某个出口的需求量——它们共同卡住了总供给。
    </p>`;
}

function renderPriorityCapacity(result: PriorityCapacityResult): void {
  if (result.status === 'invalid') {
    renderErrors(priorityResultEl, '输入有误，无法优先配水：', result.errors);
    return;
  }

  const outletRows = result.rows
    .map((o) => {
      const tag =
        o.category === 'priority'
          ? '<span class="tag tag-priority">重点</span>'
          : '<span class="tag tag-normal">普通</span>';
      return `
      <tr>
        <td>${escapeHtml(o.outlet)}</td>
        <td>${tag}</td>
        <td class="num">${o.demand}</td>
        <td class="num"><strong>${o.allocated}</strong></td>
        <td class="num ${o.shortfall > 0 ? 'bad' : 'ok'}">${o.shortfall}</td>
        <td>${o.fullySupplied ? '<span class="tag tag-ok">足额</span>' : '<span class="tag tag-cut">缺口</span>'}</td>
      </tr>`;
    })
    .join('');

  const bannerClass = result.totalShortfall > 0 ? 'warn' : 'success';
  const priorityText =
    result.priorityOutletCount > 0
      ? `第一级目标——重点出口总获配 <strong>${result.priorityAllocated}</strong> / 重点总需求
         ${result.priorityDemand}（重点缺口 ${result.priorityShortfall}，该值已是当前阀门状态与管容下的最大值）；`
      : '未选择重点出口（全部按普通处理），第一级目标值为 <strong>0</strong>；';
  const totalText =
    result.totalShortfall > 0
      ? `第二级目标——在不减少重点获配的前提下，全部出口总获配 <strong>${result.totalAllocated}</strong>
         / 总需求 ${result.totalDemand}，总缺口 <strong>${result.totalShortfall}</strong>。`
      : `第二级目标——全部出口总获配 <strong>${result.totalAllocated}</strong>，所有出口需求均已足额满足
         （总供给上限 ${result.totalSupplyCap}，总需求 ${result.totalDemand}）。`;

  priorityResultEl.innerHTML = `
    <div class="banner ${bannerClass}">
      ${priorityText}<br />${totalText}
    </div>
    <p class="hint">
      两级目标值：重点出口总获配 = <strong>${result.priorityAllocated}</strong>
      （普通出口获配合计 ${result.normalAllocated}）；全部出口总获配 = <strong>${result.totalAllocated}</strong>。
      第二阶段在第一阶段的残量网络上继续增广，可改派已有流量，不会逐出口占管造成虚假缺口。
    </p>
    <table>
      <thead>
        <tr><th>保供出口</th><th>类别</th><th>需求量</th><th>获配量</th><th>缺口</th><th>状态</th></tr>
      </thead>
      <tbody>${outletRows}</tbody>
    </table>
    <p class="hint">
      参与输水的管段（无阀管段 + 当前开启的带阀管段）共 ${result.activePipeCount} 条，每条容量为 1，
      同一无向管段双向合计只能占用一次，已关阀不参与。重点出口 ${result.priorityOutletCount} 个；
      未选重点出口时，这里的总获配量与「供水能力核验」完全一致，可直接对照。
    </p>`;
}

/** 渲染方案明细行（不改造 / 单条最优 / 两条最优），推荐方案所在行加标记。 */
function expansionPlanRow(
  label: string,
  plan: ExpansionPlan | null,
  recommended: ExpansionPlan
): string {
  if (!plan) {
    return `
      <tr>
        <td>${label}</td>
        <td class="hint">—（候选不足）</td>
        <td class="num">—</td>
        <td class="num">—</td>
      </tr>`;
  }
  const isRecommended =
    plan.upgraded.length === recommended.upgraded.length &&
    plan.upgraded.every((p, i) => p === recommended.upgraded[i]);
  const pipes =
    plan.upgraded.length > 0
      ? plan.upgraded.map((p) => `<code>${escapeHtml(p)}</code>`).join('、')
      : '<span class="hint">（不改造）</span>';
  return `
    <tr>
      <td>
        ${label}
        ${isRecommended ? '<span class="tag tag-ok">推荐</span>' : ''}
      </td>
      <td>${pipes}</td>
      <td class="num"><strong>${plan.totalAllocated}</strong></td>
      <td class="num ${plan.gain > 0 ? 'ok' : ''}">${plan.gain > 0 ? `+${plan.gain}` : '0'}</td>
    </tr>`;
}

function renderExpansion(result: ExpansionResult): void {
  if (result.status === 'invalid') {
    renderErrors(expansionResultEl, '输入有误，无法给出增容建议：', result.errors);
    return;
  }

  const rec = result.recommended;
  const recPipes =
    rec.upgraded.length > 0
      ? rec.upgraded.map((p) => `<code>${escapeHtml(p)}</code>`).join('、')
      : '（不改造）';
  const banner =
    rec.gain > 0
      ? `建议改造 <strong>${rec.upgraded.length}</strong> 条管段：${recPipes}（容量各由 1 提至 ${EXPANSION_TARGET_CAPACITY}）。
         总获配量由基线 <strong>${result.baseline}</strong> 提升至 <strong>${rec.totalAllocated}</strong>，
         增量 <strong>+${rec.gain}</strong>。`
      : `无需增容：不改造即达最高总获配量 <strong>${result.baseline}</strong>；
         改造任意单条或两条管段（容量由 1 提至 ${EXPANSION_TARGET_CAPACITY}）均无额外收益。`;
  const bannerClass = rec.gain > 0 ? 'success' : 'warn';

  const noUpgradePlan: ExpansionPlan = {
    upgraded: [],
    totalAllocated: result.baseline,
    gain: 0,
  };

  expansionResultEl.innerHTML = `
    <div class="banner ${bannerClass}">${banner}</div>
    <table>
      <thead>
        <tr><th>方案</th><th>改造管段编号</th><th>总获配量</th><th>相对基线增量</th></tr>
      </thead>
      <tbody>
        ${expansionPlanRow('不改造（基线）', noUpgradePlan, rec)}
        ${expansionPlanRow('单条改造最优', result.bestSingle, rec)}
        ${expansionPlanRow('两条组合改造最优', result.bestPair, rec)}
      </tbody>
    </table>
    <p class="hint">
      基线总获配量 <strong>${result.baseline}</strong>，推荐总获配量
      <strong>${rec.totalAllocated}</strong>，增量 <strong>+${rec.gain}</strong>；
      推荐管段编号：${recPipes}。
    </p>
    <p class="hint">
      候选管段为参与输水的不同管段（无阀管段 + 当前开启的带阀管段），共
      <strong>${result.activePipeCount}</strong> 条；已关阀及自环不可选。
      已枚举不改造、全部单条与全部两条组合（含「两条一起改造才产生收益」的情形），
      按总获配量最高、改造条数最少、管段编号（升序）列表字典序最小取舍。
      增容仅为方案测算，不会改写拓扑或已核验的供水能力结果。
    </p>`;
}

function renderValveRisks(result: ValveRiskResult): void {
  if (result.status === 'invalid') {
    renderErrors(riskResultEl, '输入有误，无法扫描：', result.errors);
    return;
  }

  const pairCount = result.scenarioCount - result.openValveCount;
  const scopeHint = `
    <p class="hint">
      仅对当前开启的阀门（${result.openValveCount} 个，上限 ${MAX_RISK_SCAN_OPEN_VALVES} 个）模拟意外关闭，
      已关阀不参与；共模拟 ${result.scenarioCount} 个场景（${result.openValveCount} 个单阀 + ${pairCount} 个双阀），
      每个场景按与「供水能力核验」相同的无向管段共享容量模型重算总获配量；扫描不改登记状态。
    </p>`;

  // 无有损场景：明确提示
  if (result.scenarios.length === 0) {
    riskResultEl.innerHTML = `
      <div class="banner success">
        未发现失供风险：全部 <strong>${result.scenarioCount}</strong> 个模拟场景的总获配量均不低于基线
        <strong>${result.baseline}</strong>——任意一个或两个当前开启阀门意外关闭都不会产生新增缺口。
      </div>
      ${scopeHint}`;
    return;
  }

  const synergisticCount = result.scenarios.filter((s) => s.synergistic).length;
  const rows = result.scenarios
    .map((s) => {
      const valves = s.closed.map((v) => `<code>${escapeHtml(v)}</code>`).join('、');
      const kindTag =
        s.closed.length === 1
          ? '<span class="tag tag-normal">单阀</span>'
          : '<span class="tag tag-low">双阀</span>';
      const verdict = s.synergistic
        ? '<span class="tag tag-cut">协同失供</span>'
        : '<span class="hint">—</span>';
      return `
        <tr>
          <td>${valves}</td>
          <td>${kindTag}</td>
          <td class="num">${s.totalAllocated}</td>
          <td class="num bad"><strong>+${s.newShortfall}</strong></td>
          <td>${verdict}</td>
        </tr>`;
    })
    .join('');

  const worst = result.scenarios[0];
  riskResultEl.innerHTML = `
    <div class="banner warn">
      发现 <strong>${result.scenarios.length}</strong> 个有损场景（共模拟 ${result.scenarioCount} 个）：
      基线总获配 <strong>${result.baseline}</strong>，最严重场景为
      ${worst.closed.map((v) => `<code>${escapeHtml(v)}</code>`).join('、')}
      意外关闭，总获配降至 <strong>${worst.totalAllocated}</strong>，新增缺口
      <strong>${worst.newShortfall}</strong>。
      ${synergisticCount > 0 ? `其中 <strong>${synergisticCount}</strong> 个双阀场景为协同失供。` : '无协同失供场景。'}
    </div>
    <table>
      <thead>
        <tr><th>意外关闭阀门</th><th>场景</th><th>场景总获配量</th><th>新增缺口</th><th>协同失供</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hint">
      新增缺口 = 基线总获配（${result.baseline}）− 场景总获配，按新增缺口降序、阀门编号列表字典序排列；
      「协同失供」指双阀场景的新增缺口严格大于两个对应单阀场景新增缺口之和（两阀互为备份、同时关闭才失供）。
    </p>
    ${scopeHint}`;
}

function renderAnomaly(result: AnomalyResult): void {
  if (result.status === 'invalid') {
    renderErrors(anomalyResultEl, '输入有误，无法定位：', result.errors);
    return;
  }
  if (result.status === 'no-match') {
    anomalyResultEl.innerHTML = `
      <div class="banner error">无匹配：${MAX_FLIPS} 处以内翻转无法解释现场观测。</div>
      <p>${escapeHtml(result.reason)}</p>
      <p class="hint">参与枚举的阀门数：${result.valveCount}（全部带阀管段，登记为开或关均可翻转）。</p>`;
    return;
  }

  const stateTag = (open: boolean): string =>
    open ? '<span class="tag tag-ok">开</span>' : '<span class="tag tag-cut">关</span>';
  /** 翻转描述，如「V08（开→关）」；id 已转义。 */
  const flipText = (sol: AnomalySolution): string =>
    sol.flipped
      .map((id) => {
        const row = sol.valveStates.find((v) => v.id === id)!;
        return `${escapeHtml(id)}（${row.registeredOpen ? '开' : '关'}→${row.actualOpen ? '开' : '关'}）`;
      })
      .join('、');

  const banner =
    result.minFlips === 0
      ? '登记状态与现场观测一致：<strong>0 处翻转</strong>即可解释全部观测，登记的阀门开闭状态无需修正。'
      : `找到 ${result.solutions.length}${result.truncated ? '+' : ''} 个匹配方案：
         最少需翻转 <strong>${result.minFlips}</strong> 处阀门状态。
         推荐方案（同数按阀门编号字典序最小）：翻转 ${flipText(result.solutions[0])}`;

  anomalyResultEl.innerHTML = `
    <div class="banner success">${banner}</div>
    <p class="hint">
      参与枚举的阀门数：${result.valveCount}（全部带阀管段，开、关状态均可翻转）；
      仅按已观测节点判定匹配，未观测节点的通水状态不参与；输入拓扑与登记开闭状态不会被修改。
    </p>
    ${result.solutions
      .map(
        (sol, i) => `
      <details class="solution" ${i === 0 ? 'open' : ''}>
        <summary>
          方案 ${i + 1}：翻转 ${sol.flipped.length} 处
          ${sol.flipped.length > 0 ? `（${flipText(sol)}）` : '（登记状态一致）'}
        </summary>
        <table>
          <thead>
            <tr><th>阀门</th><th>登记状态</th><th>翻转后状态</th><th>判定</th></tr>
          </thead>
          <tbody>
            ${sol.valveStates
              .map(
                (v) => `
              <tr>
                <td><code>${escapeHtml(v.id)}</code></td>
                <td>${stateTag(v.registeredOpen)}</td>
                <td>${stateTag(v.actualOpen)}</td>
                <td>${v.flipped ? '<span class="tag tag-low">已翻转</span>' : '<span class="hint">一致</span>'}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </details>`
      )
      .join('')}
    ${result.truncated ? '<p class="hint">匹配方案过多，仅展示前 100 个。</p>' : ''}`;
}

/** 假设的文字描述：登记状态 / 某阀门单独翻转（登记→实际）。 */
function observerHypothesisText(h: ObserverHypothesis): string {
  if (h.kind === 'baseline') return '登记状态（零翻转）';
  const from = h.registeredOpen ? '开' : '关';
  const to = h.actualOpen ? '开' : '关';
  return `翻转 ${h.flippedValve}（${from}→${to}）`;
}

function renderObserverPlan(result: ObserverPlanResult): void {
  if (result.status === 'invalid') {
    renderErrors(observerResultEl, '输入有误，无法规划：', result.errors);
    return;
  }

  const stateTag = (wet: boolean): string =>
    wet ? '<span class="tag tag-ok">有水</span>' : '<span class="tag tag-cut">无水</span>';
  const stateText = (wet: boolean): string => (wet ? '有水' : '无水');

  // 不可区分组表：组编号 / 组内假设 / 各候选点签名（推荐点加标记）
  const recommendedSet = new Set(result.recommendedPoints ?? []);
  const headerCells = result.candidates
    .map(
      (c) =>
        `<th${recommendedSet.has(c) ? ' class="recommended-col"' : ''}>${escapeHtml(c)}${
          recommendedSet.has(c) ? ' <span class="tag tag-pipe">推荐</span>' : ''
        }</th>`
    )
    .join('');
  const groupRows = result.groups
    .map((g, gi) => {
      const sigCells = g.signature
        .map(
          (wet, ci) =>
            `<td class="${recommendedSet.has(result.candidates[ci]) ? 'recommended-col' : ''}">${stateTag(wet)}</td>`
        )
        .join('');
      const hypList = g.hypotheses
        .map((h) => {
          const text = observerHypothesisText(h);
          return h.kind === 'baseline'
            ? `<li><strong>${escapeHtml(text)}</strong></li>`
            : `<li>${escapeHtml(text)}</li>`;
        })
        .join('');
      return `
        <tr>
          <td class="num"><strong>${gi + 1}</strong></td>
          <td><ul class="hyp-list">${hypList}</ul></td>
          ${sigCells}
        </tr>`;
    })
    .join('');

  if (!result.distinguishable) {
    observerResultEl.innerHTML = `
      <div class="banner warn">
        无法靠这些候选节点区分：${result.hypothesisCount} 个假设（登记状态 + 每个阀门单独翻转）
        在 ${result.candidates.length} 个候选节点上的有水 / 无水签名<strong>完全相同</strong>，
        全部归为 1 个不可区分组——仅观测这些节点无法判断是登记状态还是哪个阀门异常，
        请增设在不同假设下通水状态有差异的节点后再规划。
      </div>
      <p class="hint">
        参与枚举的阀门数：${result.valveCount}（开、关状态均可被单独翻转）；
        候选节点：${result.candidates.map((c) => `<code>${escapeHtml(c)}</code>`).join('、')}；
        求解不修改拓扑与登记的阀门状态。
      </p>
      <table>
        <thead>
          <tr><th>组</th><th>组内假设（不可区分）</th>${headerCells}</tr>
        </thead>
        <tbody>${groupRows}</tbody>
      </table>`;
    return;
  }

  const points = result.recommendedPoints!;
  // 各组在推荐观测点上的预期状态表
  const expectedHeader = points.map((p) => `<th>${escapeHtml(p)}</th>`).join('');
  const expectedRows = result.groups
    .map(
      (g, gi) => `
      <tr>
        <td class="num"><strong>${gi + 1}</strong></td>
        <td><ul class="hyp-list">${g.hypotheses.map((h) => `<li>${escapeHtml(observerHypothesisText(h))}</li>`).join('')}</ul></td>
        ${g.expectedStates.map((wet) => `<td>${stateTag(wet)}</td>`).join('')}
      </tr>`
    )
    .join('');

  observerResultEl.innerHTML = `
    <div class="banner success">
      ${result.hypothesisCount} 个假设在 ${result.candidates.length} 个候选节点上归为
      <strong>${result.groups.length}</strong> 个不可区分组；
      最少只需 <strong>${result.pointCount}</strong> 个观测点即可区分任意两组。
      推荐观测点（同数按节点名称升序列表字典序最小）：
      ${points.map((p) => `<code>${escapeHtml(p)}</code>`).join('、')}
    </div>
    <p class="hint">
      参与枚举的阀门数：${result.valveCount}（每个阀门单独翻转，开↔关）；假设总数 = 阀门数 + 1（含登记状态）。
      到推荐观测点观测后，将各点实际有水 / 无水状态与下表对照，落在哪个状态组合即对应哪个不可区分组。
      求解不修改拓扑与登记的阀门状态。
    </p>
    <h3>各组在推荐观测点的预期状态</h3>
    <table>
      <thead>
        <tr><th>组</th><th>组内假设（不可区分）</th>${expectedHeader}</tr>
      </thead>
      <tbody>${expectedRows}</tbody>
    </table>
    <details>
      <summary>全部候选节点上的有水 / 无水签名（${result.candidates.length} 个候选点，推荐点已标记）</summary>
      <table>
        <thead>
          <tr><th>组</th><th>组内假设（不可区分）</th>${headerCells}</tr>
        </thead>
        <tbody>${groupRows}</tbody>
      </table>
      <p class="hint">同一列上标记相同（同为${stateText(true)}或同为${stateText(false)}）的两个组无法靠该节点区分；
      推荐点集合保证任意两组在至少一个推荐点上的预期状态不同。</p>
    </details>`;
}

function readNetwork(): import('./solver').Network {
  let raw: unknown;
  try {
    raw = JSON.parse(topologyEl.value);
  } catch (e) {
    throw { topologyErrors: [`拓扑 JSON 解析失败：${(e as Error).message}`] };
  }
  const { network, errors } = parseNetwork(raw);
  if (!network) throw { topologyErrors: errors };
  return network;
}

function readQuery(): { network: import('./solver').Network; query: Query } {
  const network = readNetwork();
  const query: Query = {
    supplies: splitList(suppliesEl.value),
    leak: leakEl.value.trim(),
    outlets: splitList(outletsEl.value),
  };
  return { network, query };
}

function run(): void {
  try {
    const { network, query } = readQuery();
    renderResult(solve(network, query), query);
  } catch (e) {
    renderErrors(resultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
  }
}

function runInspection(): void {
  try {
    const { network, query } = readQuery();
    renderInspection(inspectResilience(network, query));
  } catch (e) {
    renderErrors(inspectResultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
  }
}

function runCapacity(): void {
  try {
    const network = readNetwork();
    if (!capacityFormState) {
      renderErrors(capacityResultEl, '请先填写核验数值：', ['点击「按上方供水点 / 保供出口生成填写表」，为各点填写非负整数后再核验。']);
      return;
    }
    const { supplyCaps, outletDemands, errors: formErrors } = readCapacityNumbers();
    if (formErrors.length > 0) {
      renderErrors(capacityResultEl, '填写有误：', formErrors);
      return;
    }
    // 填写表可能与上方名单不一致（名单改动后未重新生成）：以填写表为准构建查询
    const capacityQuery: CapacityQuery = {
      supplies: capacityFormState.supplies,
      outlets: capacityFormState.outlets,
      supplyCaps,
      outletDemands,
    };
    renderCapacity(verifyCapacity(network, capacityQuery));
  } catch (e) {
    renderErrors(capacityResultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
  }
}

function runExpansion(): void {
  try {
    const network = readNetwork();
    if (!capacityFormState) {
      renderErrors(expansionResultEl, '请先填写核验数值：', ['点击「按上方供水点 / 保供出口生成填写表」，为各点填写非负整数后再生成增容建议。']);
      return;
    }
    const { supplyCaps, outletDemands, errors: formErrors } = readCapacityNumbers();
    if (formErrors.length > 0) {
      renderErrors(expansionResultEl, '填写有误：', formErrors);
      return;
    }
    // 与供水能力核验共用同一份拓扑、供给上限与出口需求输入（填写表为权威名单）
    const capacityQuery: CapacityQuery = {
      supplies: capacityFormState.supplies,
      outlets: capacityFormState.outlets,
      supplyCaps,
      outletDemands,
    };
    renderExpansion(suggestExpansion(network, capacityQuery));
  } catch (e) {
    renderErrors(expansionResultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
  }
}

function runPriorityCapacity(): void {
  try {
    const network = readNetwork();
    if (!capacityFormState) {
      renderErrors(priorityResultEl, '请先填写核验数值：', ['点击「按上方供水点 / 保供出口生成填写表」，为各点填写非负整数并选择重点出口后再优先配水。']);
      return;
    }
    const { supplyCaps, outletDemands, priorityOutlets, errors: formErrors } = readCapacityNumbers();
    if (formErrors.length > 0) {
      renderErrors(priorityResultEl, '填写有误：', formErrors);
      return;
    }
    // 填写表可能与上方名单不一致（名单改动后未重新生成）：以填写表为准构建查询
    const capacityQuery: CapacityQuery = {
      supplies: capacityFormState.supplies,
      outlets: capacityFormState.outlets,
      supplyCaps,
      outletDemands,
      priorityOutlets,
    };
    renderPriorityCapacity(verifyPriorityCapacity(network, capacityQuery));
  } catch (e) {
    renderErrors(priorityResultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
  }
}

function runValveRiskScan(): void {
  try {
    const network = readNetwork();
    if (!capacityFormState) {
      renderErrors(riskResultEl, '请先填写核验数值：', ['点击「按上方供水点 / 保供出口生成填写表」，为各点填写非负整数后再扫描。']);
      return;
    }
    const { supplyCaps, outletDemands, errors: formErrors } = readCapacityNumbers();
    if (formErrors.length > 0) {
      renderErrors(riskResultEl, '填写有误：', formErrors);
      return;
    }
    // 与供水能力核验共用同一份拓扑、登记阀门状态与供给上限 / 出口需求（填写表为权威名单）
    const capacityQuery: CapacityQuery = {
      supplies: capacityFormState.supplies,
      outlets: capacityFormState.outlets,
      supplyCaps,
      outletDemands,
    };
    renderValveRisks(scanValveClosureRisks(network, capacityQuery));
  } catch (e) {
    renderErrors(riskResultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
  }
}

function runAnomaly(): void {
  try {
    const network = readNetwork();
    // 异常定位沿用上方「供水点」，不依赖漏点与保供出口
    const anomalyQuery: AnomalyQuery = {
      supplies: splitList(suppliesEl.value),
      wetNodes: splitList(wetNodesEl.value),
      dryNodes: splitList(dryNodesEl.value),
    };
    renderAnomaly(locateValveAnomalies(network, anomalyQuery));
  } catch (e) {
    renderErrors(anomalyResultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
  }
}

function runObserverPlan(): void {
  try {
    const network = readNetwork();
    // 观测点规划沿用上方「供水点」，不依赖漏点与保供出口；不改拓扑
    const observerQuery: ObserverQuery = {
      supplies: splitList(suppliesEl.value),
      candidates: splitList(observerCandidatesEl.value),
    };
    renderObserverPlan(planSingleValveObservers(network, observerQuery));
  } catch (e) {
    renderErrors(observerResultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
  }
}

el<HTMLButtonElement>('#load-sample').addEventListener('click', () => {
  topologyEl.value = JSON.stringify(SAMPLE_NETWORK, null, 2);
  suppliesEl.value = SAMPLE_QUERY.supplies.join(', ');
  leakEl.value = SAMPLE_QUERY.leak;
  outletsEl.value = SAMPLE_QUERY.outlets.join(', ');
  wetNodesEl.value = SAMPLE_WET_NODES.join(', ');
  dryNodesEl.value = SAMPLE_DRY_NODES.join(', ');
  observerCandidatesEl.value = SAMPLE_OBSERVER_CANDIDATES.join(', ');
  buildCapacityForm(
    SAMPLE_QUERY.supplies,
    SAMPLE_QUERY.outlets,
    SAMPLE_SUPPLY_CAPS,
    SAMPLE_OUTLET_DEMANDS,
    new Set(SAMPLE_PRIORITY_OUTLETS)
  );
  run();
  runInspection();
  runCapacity();
  runPriorityCapacity();
  runExpansion();
  runValveRiskScan();
  runAnomaly();
  runObserverPlan();
});

el<HTMLButtonElement>('#solve').addEventListener('click', run);
el<HTMLButtonElement>('#inspect').addEventListener('click', runInspection);
el<HTMLButtonElement>('#verify-capacity').addEventListener('click', runCapacity);
el<HTMLButtonElement>('#priority-capacity').addEventListener('click', runPriorityCapacity);
el<HTMLButtonElement>('#suggest-expansion').addEventListener('click', runExpansion);
el<HTMLButtonElement>('#scan-valve-risks').addEventListener('click', runValveRiskScan);
el<HTMLButtonElement>('#locate-anomaly').addEventListener('click', runAnomaly);
el<HTMLButtonElement>('#plan-observers').addEventListener('click', runObserverPlan);
el<HTMLButtonElement>('#build-capacity-form').addEventListener('click', () => {
  try {
    readNetwork(); // 仅校验拓扑 JSON，核验不依赖漏点
  } catch (e) {
    renderErrors(capacityResultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
    return;
  }
  const supplies = [...new Set(splitList(suppliesEl.value))];
  const outlets = [...new Set(splitList(outletsEl.value))];
  if (supplies.length === 0 || outlets.length === 0) {
    renderErrors(capacityResultEl, '无法生成填写表：', [
      ...(supplies.length === 0 ? ['请先在上方填写至少一个供水点。'] : []),
      ...(outlets.length === 0 ? ['请先在上方填写至少一个保供出口。'] : []),
    ]);
  }
  // 重新生成时尽量保留同节点已填数值与重点选择
  const prev = readCapacityNumbers();
  buildCapacityForm(supplies, outlets, prev.supplyCaps, prev.outletDemands, new Set(prev.priorityOutlets));
});
