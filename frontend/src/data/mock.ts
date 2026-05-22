import type {
  Application, Release, Module, Feature, Process,
  TestCase, TestStep, TestRun, AuditEntry, Workspace, HierarchyNode,
  TestRunCaseResult, TestCaseType, StepAction, ValidationTypeEnum, UniqueMandatory, DataType, TestingType,
  RunScreenshot, Team, RunTemplate,
  ClientRepo, TestCaseOverride, TestCaseTombstone, RepoId, CaseDiffEntry,
  PublishRecord,
} from '@/types';

export const workspaces: Workspace[] = [
  {
    id: 'ws-1', name: 'Engineering Team',
    members: [
      { id: 'm1', userId: 'u1', name: 'Sarah Chen', email: 'sarah@acme.com', role: 'owner' },
      { id: 'm2', userId: 'u2', name: 'James Miller', email: 'james@acme.com', role: 'contributor' },
      { id: 'm3', userId: 'u3', name: 'Priya Patel', email: 'priya@acme.com', role: 'operator' },
      { id: 'm4', userId: 'u4', name: 'Alex Kim', email: 'alex@acme.com', role: 'viewer' },
    ],
  },
  { id: 'ws-2', name: 'QA Division', members: [] },
];

export const applications: Application[] = [
  { id: 'app-1', name: 'Oracle Fusion', workspaceId: 'ws-1', description: 'Oracle Fusion Cloud ERP', createdAt: '2025-01-15' },
  { id: 'app-2', name: 'SAP S/4HANA', workspaceId: 'ws-1', description: 'SAP Enterprise Resource Planning', createdAt: '2025-02-01' },
];

export const releases: Release[] = [
  { id: 'rel-1', name: 'R13 26A', applicationId: 'app-1', version: 'R13 26A', createdAt: '2025-03-01' },
  { id: 'rel-2', name: 'R13 26B', applicationId: 'app-1', version: 'R13 26B', createdAt: '2025-03-15' },
  { id: 'rel-3', name: '2025 FPS01', applicationId: 'app-2', version: '2025 FPS01', createdAt: '2025-02-20' },
];

export const modules: Module[] = [
  // Modules now belong to an Application (release-independent). releaseId kept for back-compat.
  { id: 'mod-1', name: 'Human Capital Management', applicationId: 'app-1', releaseId: 'rel-1' },
  { id: 'mod-2', name: 'Financial Management', applicationId: 'app-1', releaseId: 'rel-1' },
  { id: 'mod-3', name: 'Supply Chain Management', applicationId: 'app-1', releaseId: 'rel-1' },
  { id: 'mod-4', name: 'Human Capital Management', applicationId: 'app-1', releaseId: 'rel-2' },
];                                                            

export const features: Feature[] = [
  { id: 'feat-1', name: 'Administration', moduleId: 'mod-1' },
  { id: 'feat-2', name: 'Benefits', moduleId: 'mod-1' },
  { id: 'feat-3', name: 'Recruitment', moduleId: 'mod-1' },
  { id: 'feat-4', name: 'Invoice Processing', moduleId: 'mod-2' },
  { id: 'feat-5', name: 'Journal Entries', moduleId: 'mod-2' },
  { id: 'feat-6', name: 'Purchase Orders', moduleId: 'mod-3' },
  { id: 'feat-7', name: 'Inventory Management', moduleId: 'mod-3' },
  { id: 'feat-8', name: 'Shipping & Logistics', moduleId: 'mod-3' },
];

// --- Business Processes (cross-cutting, end-to-end flows) ---
export const processes: Process[] = [
  { id: 'proc-1', name: 'Hire-to-Retire', description: 'Recruit, onboard, manage, and offboard employees', applicationId: 'app-1' },
  { id: 'proc-2', name: 'Procure-to-Pay', description: 'Requisition through invoice payment', applicationId: 'app-1' },
  { id: 'proc-3', name: 'Order-to-Cash', description: 'Customer order through cash collection', applicationId: 'app-1' },
  { id: 'proc-4', name: 'Record-to-Report', description: 'Journal entries through financial reporting', applicationId: 'app-1' },
  { id: 'proc-5', name: 'Plan-to-Inventory', description: 'Demand planning, inventory, fulfillment', applicationId: 'app-1' },
  { id: 'proc-6', name: 'Month-End Close', description: 'Period close, reconciliation, and statement generation', applicationId: 'app-1' },
];

// --- Master label vocabulary used for tagging test cases ---
export const labelVocabulary: string[] = [
  'smoke', 'regression', 'critical-path', 'sanity', 'happy-path', 'edge-case',
  'security', 'performance', 'integration', 'data-migration',
];

// Map a feature → likely processes (used during seeding).
const featureProcessMap: Record<string, string[]> = {
  'feat-1': ['proc-1'],                   // HCM Administration → Hire-to-Retire
  'feat-2': ['proc-1'],                   // HCM Benefits → Hire-to-Retire
  'feat-3': ['proc-1'],                   // HCM Recruitment → Hire-to-Retire
  'feat-4': ['proc-2', 'proc-6'],         // AP Invoice → Procure-to-Pay, Month-End Close
  'feat-5': ['proc-4', 'proc-6'],         // GL Journal → Record-to-Report, Month-End Close
  'feat-6': ['proc-2'],                   // Purchase Orders → Procure-to-Pay
  'feat-7': ['proc-5'],                   // Inventory → Plan-to-Inventory
  'feat-8': ['proc-3', 'proc-5'],         // Shipping → Order-to-Cash, Plan-to-Inventory
};

// --- Seed-based pseudo-random for deterministic generation ---
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const rand = seededRandom(42);
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)]; }
function pickWeighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// --- Feature config for generation ---
interface FeatureConfig {
  featureId: string;
  moduleId: string;
  releaseId: string;
  prefix: string;
  count: number;
  names: string[];
  roles: string[];
}

const featureConfigs: FeatureConfig[] = [
  {
    featureId: 'feat-1', moduleId: 'mod-1', releaseId: 'rel-1', prefix: 'HCM.ADM', count: 150,
    roles: ['Manager', 'HR Specialist', 'Manager, HR Specialist', 'HR Administrator', 'System Administrator'],
    names: [
      'Promote direct report', 'Transfer employee to another department', 'Terminate employee',
      'Rehire former employee', 'Update employee personal information', 'Change employee job title',
      'Assign new manager', 'Create new position', 'Close vacant position', 'Update work schedule',
      'Add emergency contact', 'Update employee address', 'Process name change',
      'Assign cost center', 'Update reporting hierarchy', 'Set probation period',
      'Extend probation period', 'Complete onboarding checklist', 'Archive employee record',
      'Assign security role', 'Remove security role', 'Generate org chart',
      'Export employee roster', 'Bulk update department codes', 'Validate data integrity',
      'Configure approval workflow', 'Set delegation rules', 'Process mass transfer',
      'Update location assignment', 'Merge duplicate records',
    ],
  },
  {
    featureId: 'feat-2', moduleId: 'mod-1', releaseId: 'rel-1', prefix: 'HCM.BEN', count: 130,
    roles: ['Benefits Administrator', 'HR Specialist', 'Benefits Analyst', 'Payroll Administrator'],
    names: [
      'Enroll employee in benefits plan', 'Terminate benefits enrollment', 'Change benefits election',
      'Process life event change', 'Add dependent to plan', 'Remove dependent from plan',
      'Calculate benefits cost', 'Generate benefits statement', 'Process open enrollment',
      'Validate enrollment eligibility', 'Create new benefits plan', 'Deactivate benefits plan',
      'Process COBRA notification', 'Update premium rates', 'Generate deduction report',
      'Reconcile benefits billing', 'Process retroactive enrollment', 'Approve benefits exception',
      'Configure waiting period', 'Set coverage tiers', 'Process qualifying event',
      'Generate 1095-C forms', 'Audit benefits enrollment', 'Process wellness program enrollment',
      'Update FSA contribution', 'Process HSA rollover', 'Calculate ACA compliance',
      'Generate benefits summary', 'Process domestic partner enrollment', 'Archive expired plans',
    ],
  },
  {
    featureId: 'feat-3', moduleId: 'mod-1', releaseId: 'rel-1', prefix: 'HCM.REC', count: 120,
    roles: ['Recruiter', 'Hiring Manager', 'HR Specialist', 'Recruitment Coordinator'],
    names: [
      'Create job requisition', 'Post job externally', 'Post job internally',
      'Screen candidate application', 'Schedule interview', 'Send offer letter',
      'Approve job requisition', 'Reject candidate', 'Move candidate to next stage',
      'Create talent pool', 'Search candidate database', 'Generate recruitment report',
      'Close job requisition', 'Extend job posting', 'Configure screening questions',
      'Create interview template', 'Process background check', 'Generate offer approval',
      'Onboard new hire', 'Process candidate withdrawal', 'Bulk import candidates',
      'Configure career site', 'Set up referral program', 'Process rehire request',
      'Evaluate candidate assessment', 'Schedule panel interview', 'Create sourcing campaign',
      'Track recruitment metrics', 'Process relocation package', 'Archive old requisitions',
    ],
  },
  {
    featureId: 'feat-4', moduleId: 'mod-2', releaseId: 'rel-1', prefix: 'FIN.AP', count: 180,
    roles: ['AP Clerk', 'AP Manager', 'Finance Analyst', 'AP Supervisor', 'Accounts Payable Specialist'],
    names: [
      'Create standard invoice', 'Create credit memo', 'Process payment batch',
      'Approve invoice for payment', 'Match invoice to PO', 'Process prepayment',
      'Void invoice', 'Create recurring invoice', 'Process expense report',
      'Validate supplier invoice', 'Apply holds on invoice', 'Release invoice hold',
      'Create debit memo', 'Process quick invoice', 'Generate payment file',
      'Reconcile AP aging', 'Process withholding tax', 'Create payment template',
      'Process foreign currency invoice', 'Apply early payment discount',
      'Manage supplier bank accounts', 'Generate 1099 report', 'Process intercompany invoice',
      'Create invoice from receipt', 'Validate tax calculation', 'Process installment payment',
      'Generate AP trial balance', 'Process refund', 'Reverse payment',
      'Archive paid invoices',
    ],
  },
  {
    featureId: 'feat-5', moduleId: 'mod-2', releaseId: 'rel-1', prefix: 'FIN.GL', count: 170,
    roles: ['GL Accountant', 'Financial Controller', 'Senior Accountant', 'GL Manager'],
    names: [
      'Post journal entry', 'Reverse journal entry', 'Create recurring journal',
      'Process accrual entry', 'Close accounting period', 'Open accounting period',
      'Run trial balance', 'Generate financial statements', 'Process intercompany journal',
      'Create allocation journal', 'Process revaluation', 'Reconcile bank statement',
      'Post adjustment entry', 'Create statistical journal', 'Run consolidation',
      'Generate balance sheet', 'Generate income statement', 'Process year-end close',
      'Create chart of accounts segment', 'Validate journal entry', 'Process elimination entry',
      'Generate cash flow statement', 'Create budget journal', 'Process translation adjustment',
      'Archive closed periods', 'Generate audit trail report', 'Process suspense account clearing',
      'Create cross-currency journal', 'Run account analysis', 'Generate variance report',
    ],
  },
  {
    featureId: 'feat-6', moduleId: 'mod-3', releaseId: 'rel-1', prefix: 'SCM.PO', count: 100,
    roles: ['Buyer', 'Procurement Manager', 'Purchasing Agent', 'Category Manager'],
    names: [
      'Create purchase order', 'Approve purchase order', 'Cancel purchase order',
      'Create blanket purchase agreement', 'Process PO change order', 'Receive goods against PO',
      'Create purchase requisition', 'Convert requisition to PO', 'Process return to supplier',
      'Create supplier contract', 'Negotiate pricing', 'Process three-way match',
      'Generate PO commitment report', 'Close completed PO', 'Process PO acknowledgment',
      'Create spot buy order', 'Manage supplier catalog', 'Process drop shipment',
      'Generate procurement analytics', 'Validate budget availability',
      'Create sourcing event', 'Evaluate supplier bid', 'Award supplier contract',
      'Process emergency purchase', 'Archive historical POs', 'Manage approved supplier list',
      'Create purchase order template', 'Process consignment PO', 'Validate compliance',
      'Generate spend analysis',
    ],
  },
  {
    featureId: 'feat-7', moduleId: 'mod-3', releaseId: 'rel-1', prefix: 'SCM.INV', count: 80,
    roles: ['Inventory Manager', 'Warehouse Clerk', 'Inventory Analyst', 'Materials Planner'],
    names: [
      'Perform cycle count', 'Process stock transfer', 'Create inventory adjustment',
      'Generate inventory valuation', 'Process physical inventory', 'Set reorder point',
      'Create material reservation', 'Process scrap transaction', 'Generate aging report',
      'Perform ABC analysis', 'Create lot number', 'Track serial number',
      'Process consignment inventory', 'Generate min-max report', 'Process interorg transfer',
      'Create subinventory', 'Validate on-hand quantity', 'Process receipt into inventory',
      'Generate movement report', 'Configure item attributes',
      'Process inventory recounting', 'Create item category', 'Update item cost',
      'Process obsolescence review', 'Generate demand forecast', 'Set safety stock level',
      'Process kit assembly', 'Create inventory organization', 'Validate lot expiry',
      'Archive inactive items',
    ],
  },
  {
    featureId: 'feat-8', moduleId: 'mod-3', releaseId: 'rel-1', prefix: 'SCM.SHP', count: 70,
    roles: ['Shipping Clerk', 'Logistics Manager', 'Warehouse Supervisor', 'Transportation Planner'],
    names: [
      'Create shipment', 'Process pick release', 'Confirm shipment delivery',
      'Generate bill of lading', 'Process return shipment', 'Create shipping label',
      'Schedule carrier pickup', 'Track shipment status', 'Process freight cost',
      'Create delivery route', 'Process backorder', 'Generate shipping manifest',
      'Process customs documentation', 'Calculate shipping cost', 'Create packing slip',
      'Process partial shipment', 'Manage carrier contracts', 'Process cross-docking',
      'Generate delivery performance report', 'Validate shipping address',
      'Process hazardous materials shipment', 'Create consolidation shipment',
      'Process last mile delivery', 'Generate proof of delivery', 'Archive completed shipments',
      'Configure shipping method', 'Process freight audit', 'Create wave plan',
      'Process inbound shipment', 'Validate weight and dimensions',
    ],
  },
];

// --- Preserve original 6 test cases ---
const originalTestCases: TestCase[] = [
  {
    id: 'tc-1', caseNumber: 'HCM.ADM.384', testCaseName: 'Promote direct report',
    featureId: 'feat-1', moduleId: 'mod-1', releaseId: 'rel-1',
    releaseIds: ['rel-1', 'rel-2'], processIds: ['proc-1'], labels: ['regression', 'critical-path'],
    role: 'Manager, HR Specialist',
    description: 'Promote direct report through the manager self-service portal',
    expectedResult: 'Employee promotion is successfully processed',
    type: 'standard', status: 'valid', order: 1,
    createdAt: '2025-03-02', updatedAt: '2025-03-10',
  },
  {
    id: 'tc-2', caseNumber: 'HCM.ADM.385', testCaseName: 'Transfer employee to another department',
    featureId: 'feat-1', moduleId: 'mod-1', releaseId: 'rel-1',
    releaseIds: ['rel-1', 'rel-2'], processIds: ['proc-1'], labels: ['regression'],
    role: 'Manager, HR Specialist',
    description: 'Transfer an employee between departments using manager self-service',
    expectedResult: 'Employee transfer is successfully completed',
    type: 'standard', status: 'valid', order: 2,
    dependency: 'HCM.ADM.384',
    createdAt: '2025-03-02', updatedAt: '2025-03-12',
  },
  {
    id: 'tc-3', caseNumber: 'HCM.BEN.101', testCaseName: 'Enroll employee in benefits plan',
    featureId: 'feat-2', moduleId: 'mod-1', releaseId: 'rel-1',
    releaseIds: ['rel-1'], processIds: ['proc-1'], labels: ['smoke', 'happy-path'],
    role: 'Benefits Administrator',
    description: 'Enroll a new hire into the company benefits plan',
    expectedResult: 'Benefits enrollment is confirmed',
    type: 'standard', status: 'valid', order: 1,
    createdAt: '2025-03-05', updatedAt: '2025-03-05',
  },
  {
    id: 'tc-4', caseNumber: 'FIN.AP.201', testCaseName: 'Create standard invoice',
    featureId: 'feat-4', moduleId: 'mod-2', releaseId: 'rel-1',
    releaseIds: ['rel-1', 'rel-2'], processIds: ['proc-2', 'proc-6'], labels: ['regression', 'critical-path'],
    role: 'AP Clerk',
    description: 'Create a standard vendor invoice in the AP module',
    expectedResult: 'Invoice is created and validated',
    type: 'standard', status: 'valid', order: 1,
    createdAt: '2025-03-08', updatedAt: '2025-03-14',
  },
  {
    id: 'tc-5', caseNumber: 'FIN.GL.301', testCaseName: 'Post journal entry',
    featureId: 'feat-5', moduleId: 'mod-2', releaseId: 'rel-1',
    releaseIds: ['rel-1', 'rel-2'], processIds: ['proc-4', 'proc-6'], labels: ['smoke', 'critical-path'],
    role: 'GL Accountant',
    description: 'Create and post a manual journal entry',
    expectedResult: 'Journal entry is posted successfully',
    type: 'standard', status: 'valid', order: 1,
    createdAt: '2025-03-06', updatedAt: '2025-03-06',
  },
  {
    id: 'tc-6', caseNumber: 'FIN.GL.302', testCaseName: 'Reverse journal entry',
    featureId: 'feat-5', moduleId: 'mod-2', releaseId: 'rel-1',
    releaseIds: ['rel-1'], processIds: ['proc-4', 'proc-6'], labels: ['regression'],
    role: 'GL Accountant',
    description: 'Reverse a posted journal entry',
    expectedResult: 'Journal reversal is posted',
    type: 'standard', status: 'valid', order: 2,
    dependency: 'FIN.GL.301',
    createdAt: '2025-03-07', updatedAt: '2025-03-07',
  },
];

// Map original case numbers to skip during generation
const originalCaseNumbers = new Set(originalTestCases.map(tc => tc.caseNumber));

// --- Generate ~1000 test cases ---
const statuses: Array<'valid' | 'draft' | 'archived'> = ['valid', 'draft', 'archived'];
const statusWeights = [75, 15, 10];
const types: TestCaseType[] = ['standard', 'customized'];
const typeWeights = [85, 15];

const generatedTestCases: TestCase[] = [];
let tcCounter = 7; // start after tc-6

const dayOffsets: number[] = [];
for (let i = 0; i < 60; i++) dayOffsets.push(i);

function makeDate(dayOffset: number): string {
  const d = new Date(2025, 1, 1); // Feb 1
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

for (const cfg of featureConfigs) {
  const casesForFeature: TestCase[] = [];
  for (let i = 1; i <= cfg.count; i++) {
    const caseNum = `${cfg.prefix}.${String(i).padStart(3, '0')}`;
    if (originalCaseNumbers.has(caseNum)) continue;

    const name = cfg.names[(i - 1) % cfg.names.length];
    const suffix = i > cfg.names.length ? ` — variant ${Math.ceil(i / cfg.names.length)}` : '';
    
    const status = pickWeighted(statuses, statusWeights);
    const type = pickWeighted(types, typeWeights);
    const role = pick(cfg.roles);
    const createdDay = Math.floor(rand() * 50);
    const updatedDay = createdDay + Math.floor(rand() * 10);

    const hasDep = rand() < 0.2 && casesForFeature.length > 0;
    const depCase = hasDep ? pick(casesForFeature) : undefined;

    // --- Tag generation ---
    // Releases: every test belongs to its primary release; ~40% are also tagged into another release.
    const allReleaseIds = releases.map(r => r.id);
    const otherReleases = allReleaseIds.filter(rid => rid !== cfg.releaseId);
    const releaseIds = [cfg.releaseId];
    if (rand() < 0.4 && otherReleases.length > 0) {
      releaseIds.push(pick(otherReleases));
    }
    // Processes: derived from feature, with small chance of secondary tag.
    const featureProcesses = featureProcessMap[cfg.featureId] ?? [];
    const processIds = [...featureProcesses];
    if (rand() < 0.15) {
      const others = processes.map(p => p.id).filter(pid => !processIds.includes(pid));
      if (others.length > 0) processIds.push(pick(others));
    }
    // Labels: 0-2 random labels weighted toward common ones.
    const labelPool = ['regression', 'regression', 'smoke', 'happy-path', 'edge-case', 'critical-path', 'integration'];
    const labels: string[] = [];
    if (rand() < 0.7) labels.push(pick(labelPool));
    if (rand() < 0.25) {
      const second = pick(labelPool);
      if (!labels.includes(second)) labels.push(second);
    }

    const tc: TestCase = {
      id: `tc-${tcCounter++}`,
      caseNumber: caseNum,
      testCaseName: `${name}${suffix}`,
      featureId: cfg.featureId,
      moduleId: cfg.moduleId,
      releaseId: cfg.releaseId,
      releaseIds,
      processIds,
      labels,
      role,
      description: `${name}${suffix} in ${cfg.prefix.replace('.', ' ')} module`,
      expectedResult: `${name}${suffix} completed successfully`,
      
      type,
      status,
      order: i,
      dependency: depCase?.caseNumber,
      createdAt: makeDate(createdDay),
      updatedAt: makeDate(updatedDay),
    };
    casesForFeature.push(tc);
    generatedTestCases.push(tc);
  }
}

export const testCases: TestCase[] = [...originalTestCases, ...generatedTestCases];

// Ensure every master case has an explicit version (used for drift detection).
testCases.forEach(tc => { if (tc.version == null) tc.version = 1; });
// Bump a few master cases to v2 so the Compare view can demo "master moved on" drift.
const driftCaseNumbers = new Set(['HCM.ADM.384', 'FIN.AP.201']);
testCases.forEach(tc => { if (driftCaseNumbers.has(tc.caseNumber)) tc.version = 2; });

/** Alias: the canonical (master) library. Use `resolveCases(repoId)` to get a repo-aware view. */
export const masterTestCases: TestCase[] = testCases;

// --- Original test steps (preserved) ---
const originalTestSteps: TestStep[] = [
  { id: 'ts-1', testCaseId: 'tc-1', lineNumber: 10, stepDescription: 'Enter the Value in User ID>Password', inputParameter: 'User ID>Password', action: 'login_into_application', validationType: 'validation_from_application', validationName: 'Get UserId', uniqueMandatory: 'mandatory', dataType: 'alpha_numeric', testingType: 'not_applicable' },
  { id: 'ts-2', testCaseId: 'tc-1', lineNumber: 20, stepDescription: 'Click on Home', inputParameter: 'Home', action: 'click_icon', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-3', testCaseId: 'tc-1', lineNumber: 30, stepDescription: 'Click on My Team', inputParameter: 'My Team', action: 'click_link', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-4', testCaseId: 'tc-1', lineNumber: 40, stepDescription: 'Click on Show More', inputParameter: 'Show More', action: 'click_link', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-5', testCaseId: 'tc-1', lineNumber: 50, stepDescription: 'Click on Promote', inputParameter: 'Employment>Promote', action: 'click_link', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-6', testCaseId: 'tc-1', lineNumber: 60, stepDescription: 'Wait till load', inputParameter: 'Wait till load', action: 'wait_till_load', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-7', testCaseId: 'tc-1', lineNumber: 80, stepDescription: 'Search Person', inputParameter: 'Search by Name, Business Title', action: 'enter_value_text_field_oj', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-8', testCaseId: 'tc-1', lineNumber: 85, stepDescription: 'Click Enter', inputParameter: 'Enter', action: 'key_enter', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-9', testCaseId: 'tc-1', lineNumber: 90, stepDescription: 'Wait till load', inputParameter: 'Wait till load', action: 'wait_till_load', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-10', testCaseId: 'tc-1', lineNumber: 100, stepDescription: 'Click Enter', inputParameter: 'Enter', action: 'key_enter', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-11', testCaseId: 'tc-1', lineNumber: 110, stepDescription: 'Click on Continue Without Journey', inputParameter: 'Continue Without Journey', action: 'click_button', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-12', testCaseId: 'tc-1', lineNumber: 120, stepDescription: 'Wait till load', inputParameter: 'Wait Till Load', action: 'wait_till_load', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-13', testCaseId: 'tc-1', lineNumber: 130, stepDescription: 'When does the promotion start?', inputParameter: 'When does the promotion start...', action: 'date_picker', validationType: 'format_expression', validationName: 'dd-MMM-YYYY', uniqueMandatory: 'mandatory', dataType: 'date', testingType: 'not_applicable' },
  { id: 'ts-14', testCaseId: 'tc-1', lineNumber: 140, stepDescription: 'Key Tab', inputParameter: 'Key Tab', action: 'key_tab', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-15', testCaseId: 'tc-1', lineNumber: 150, stepDescription: 'Wait Till Load', inputParameter: 'Wait Till Load', action: 'wait_till_load', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-16', testCaseId: 'tc-1', lineNumber: 160, stepDescription: 'Why are you promoting UOCQAIG OREKGD?', inputParameter: 'Why are you promoting UOC...', action: 'enter_value_text_field', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-17', testCaseId: 'tc-1', lineNumber: 165, stepDescription: 'Click Enter', inputParameter: 'Enter', action: 'key_enter', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-18', testCaseId: 'tc-1', lineNumber: 170, stepDescription: 'Click on Continue', inputParameter: 'Continue', action: 'click_button', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-19', testCaseId: 'tc-1', lineNumber: 180, stepDescription: 'Wait Till Load', inputParameter: 'Wait Till Load', action: 'wait_till_load', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-20', testCaseId: 'tc-1', lineNumber: 190, stepDescription: 'Click on Get help with Assignment', inputParameter: 'Get help with Assignment', action: 'click_link', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-21', testCaseId: 'tc-4', lineNumber: 10, stepDescription: 'Enter the Value in User ID>Password', inputParameter: 'User ID>Password', action: 'login_into_application', validationType: 'validation_from_application', validationName: 'Get UserId', uniqueMandatory: 'mandatory', dataType: 'alpha_numeric', testingType: 'not_applicable' },
  { id: 'ts-22', testCaseId: 'tc-4', lineNumber: 20, stepDescription: 'Navigate to Payables', inputParameter: 'Payables', action: 'navigate_to_url', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-23', testCaseId: 'tc-4', lineNumber: 30, stepDescription: 'Click on Create Invoice', inputParameter: 'Create Invoice', action: 'click_button', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable' },
  { id: 'ts-24', testCaseId: 'tc-4', lineNumber: 40, stepDescription: 'Enter Supplier Name', inputParameter: 'Supplier Name', action: 'enter_value_text_field', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'mandatory', dataType: 'alpha_numeric', testingType: 'not_applicable' },
  { id: 'ts-25', testCaseId: 'tc-4', lineNumber: 50, stepDescription: 'Enter Invoice Amount', inputParameter: 'Invoice Amount', action: 'enter_value_text_field', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'mandatory', dataType: 'numeric', testingType: 'not_applicable' },
  { id: 'ts-26', testCaseId: 'tc-4', lineNumber: 60, stepDescription: 'Click Save', inputParameter: 'Save', action: 'click_button', validationType: 'validation_from_application', validationName: 'Invoice Created Successfully', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'not_applicable', capturedData: 'invoiceNumber' },
];

// --- Generate steps for first 50 generated test cases ---
const actionPool: StepAction[] = ['login_into_application', 'click_icon', 'click_link', 'click_button', 'enter_value_text_field', 'enter_value_text_field_oj', 'key_enter', 'key_tab', 'wait_till_load', 'date_picker', 'select_dropdown', 'navigate_to_url', 'validate_text'];
const valTypes: ValidationTypeEnum[] = ['not_applicable', 'validation_from_application', 'format_expression'];
const valWeights = [70, 20, 10];
const mandatoryOpts: UniqueMandatory[] = ['not_applicable', 'mandatory'];
const dataTypes: DataType[] = ['not_applicable', 'alpha_numeric', 'numeric', 'date', 'text'];
const testingTypes: TestingType[] = ['not_applicable', 'positive', 'negative'];

const generatedSteps: TestStep[] = [];
let stepCounter = 27; // after ts-26

const casesForSteps = generatedTestCases.slice(0, 50);
for (const tc of casesForSteps) {
  const stepCount = 5 + Math.floor(rand() * 11); // 5-15
  for (let s = 1; s <= stepCount; s++) {
    const action = s === 1 ? 'login_into_application' as StepAction : pick(actionPool);
    const vt = pickWeighted(valTypes, valWeights);
    generatedSteps.push({
      id: `ts-${stepCounter++}`,
      testCaseId: tc.id,
      lineNumber: s * 10,
      stepDescription: `Step ${s}: ${action.replace(/_/g, ' ')}`,
      inputParameter: action === 'login_into_application' ? 'User ID>Password' : `Parameter ${s}`,
      action,
      validationType: vt,
      validationName: vt === 'not_applicable' ? 'Not Applicable' : vt === 'format_expression' ? 'dd-MMM-YYYY' : 'Validate Result',
      uniqueMandatory: rand() < 0.3 ? 'mandatory' : 'not_applicable',
      dataType: pick(dataTypes),
      testingType: pick(testingTypes),
    });
  }
}

export const testSteps: TestStep[] = [...originalTestSteps, ...generatedSteps];

// --- Test Runs (expanded) ---
const run3Cases = testCases.filter(tc => tc.moduleId === 'mod-1').slice(0, 80).map(tc => tc.id);
const run4Cases = testCases.filter(tc => tc.releaseId === 'rel-1').slice(0, 100).map(tc => tc.id);

export const testRuns: TestRun[] = [
  { id: 'run-1', name: 'HCM Admin Regression — R13 26A', releaseId: 'rel-1', moduleId: 'mod-1', environment: 'qa', status: 'passed', createdBy: 'Sarah Chen', startedAt: '2025-03-20T09:30:00Z', completedAt: '2025-03-20T09:45:00Z', progress: 100, totalCases: 3, passedCases: 3, failedCases: 0, selectedCaseIds: ['tc-1', 'tc-2', 'tc-3'], teamId: 'team-3', iterationCounts: { 'tc-1': 3 } },
  { id: 'run-2', name: 'Finance GL Smoke Test', releaseId: 'rel-1', moduleId: 'mod-2', environment: 'dev', status: 'failed', createdBy: 'James Miller', startedAt: '2025-03-21T14:00:00Z', completedAt: '2025-03-21T14:12:00Z', progress: 100, totalCases: 2, passedCases: 1, failedCases: 1, selectedCaseIds: ['tc-4', 'tc-5'], teamId: 'team-1' },
  { id: 'run-3', name: 'HCM Full Suite — UAT', releaseId: 'rel-1', moduleId: 'mod-1', environment: 'uat', status: 'running', createdBy: 'Priya Patel', startedAt: '2025-03-22T08:00:00Z', progress: 65, totalCases: run3Cases.length, passedCases: Math.floor(run3Cases.length * 0.55), failedCases: Math.floor(run3Cases.length * 0.1), selectedCaseIds: run3Cases, teamId: 'team-3' },
  { id: 'run-4', name: 'Pre-Release Validation — R13 26B', releaseId: 'rel-2', moduleId: 'mod-4', environment: 'qa', status: 'pending', createdBy: 'Sarah Chen', startedAt: '2025-03-25T10:00:00Z', progress: 0, totalCases: run4Cases.length, passedCases: 0, failedCases: 0, selectedCaseIds: run4Cases },
  { id: 'run-5', name: 'SCM Inventory Validation', releaseId: 'rel-1', moduleId: 'mod-3', environment: 'qa', status: 'passed', createdBy: 'Alex Kim', startedAt: '2025-03-23T10:00:00Z', completedAt: '2025-03-23T11:30:00Z', progress: 100, totalCases: 50, passedCases: 48, failedCases: 2, selectedCaseIds: testCases.filter(tc => tc.moduleId === 'mod-3').slice(0, 50).map(tc => tc.id), teamId: 'team-2' },
  { id: 'run-6', name: 'AP Invoice Processing — Full', releaseId: 'rel-1', moduleId: 'mod-2', environment: 'uat', status: 'failed', createdBy: 'James Miller', startedAt: '2025-03-24T09:00:00Z', completedAt: '2025-03-24T10:45:00Z', progress: 100, totalCases: 90, passedCases: 82, failedCases: 8, selectedCaseIds: testCases.filter(tc => tc.featureId === 'feat-4').slice(0, 90).map(tc => tc.id), teamId: 'team-1' },
];

// --- Test Run Case Results (original preserved + some generated) ---
export const testRunCaseResults: Record<string, TestRunCaseResult[]> = {
  'run-1': [
    { testCaseId: 'tc-1', status: 'passed', duration: 45200, error: undefined, stepResults: [
      { stepId: 'ts-1', status: 'passed', duration: 3200 },
      { stepId: 'ts-2', status: 'passed', duration: 1100 },
      { stepId: 'ts-3', status: 'passed', duration: 1400 },
      { stepId: 'ts-4', status: 'passed', duration: 900 },
      { stepId: 'ts-5', status: 'passed', duration: 1200 },
      { stepId: 'ts-6', status: 'passed', duration: 4500 },
      { stepId: 'ts-7', status: 'passed', duration: 2300 },
      { stepId: 'ts-8', status: 'passed', duration: 800 },
      { stepId: 'ts-9', status: 'passed', duration: 3800 },
      { stepId: 'ts-10', status: 'passed', duration: 700 },
    ]},
    { testCaseId: 'tc-2', status: 'passed', duration: 38400, error: undefined, stepResults: [] },
    { testCaseId: 'tc-3', status: 'passed', duration: 22100, error: undefined, stepResults: [] },
  ],
  'run-2': [
    { testCaseId: 'tc-4', status: 'passed', duration: 31200, error: undefined, stepResults: [
      { stepId: 'ts-21', status: 'passed', duration: 3100 },
      { stepId: 'ts-22', status: 'passed', duration: 2200 },
      { stepId: 'ts-23', status: 'passed', duration: 1800 },
      { stepId: 'ts-24', status: 'passed', duration: 2400 },
      { stepId: 'ts-25', status: 'passed', duration: 1900 },
      { stepId: 'ts-26', status: 'passed', duration: 1500 },
    ]},
    { testCaseId: 'tc-5', status: 'failed', duration: 18700, error: 'GL period is closed. Cannot post journal entry to March 2025.', stepResults: [] },
  ],
  'run-3': [
    { testCaseId: 'tc-1', status: 'passed', duration: 47800, error: undefined, stepResults: [
      { stepId: 'ts-1', status: 'passed', duration: 3500 },
      { stepId: 'ts-2', status: 'passed', duration: 1200 },
      { stepId: 'ts-3', status: 'passed', duration: 1600 },
      { stepId: 'ts-4', status: 'passed', duration: 1100 },
      { stepId: 'ts-5', status: 'passed', duration: 1300 },
      { stepId: 'ts-6', status: 'passed', duration: 5200 },
      { stepId: 'ts-7', status: 'passed', duration: 2800 },
      { stepId: 'ts-8', status: 'passed', duration: 900 },
      { stepId: 'ts-9', status: 'passed', duration: 4100 },
      { stepId: 'ts-10', status: 'passed', duration: 750 },
    ]},
    { testCaseId: 'tc-2', status: 'failed', duration: 29300, error: 'Element "Transfer" not found on page. Timeout after 30s.', stepResults: [
      { stepId: 'ts-1', status: 'passed', duration: 3200 },
      { stepId: 'ts-2', status: 'passed', duration: 1100 },
      { stepId: 'ts-3', status: 'passed', duration: 1500 },
      { stepId: 'ts-4', status: 'failed', duration: 30000, error: 'Element "Transfer" not found on page. Timeout after 30s.', screenshotUrl: '/placeholder.svg' },
      { stepId: 'ts-5', status: 'skipped', duration: 0 },
    ]},
    { testCaseId: 'tc-3', status: 'running', duration: 0, error: undefined, stepResults: [] },
  ],
};

// --- Audit entries (expanded) ---
export const auditEntries: AuditEntry[] = [
  { id: 'aud-1', entity: 'TestCase', entityId: 'tc-1', entityName: 'HCM.ADM.384 — Promote direct report', action: 'updated', before: { testCaseName: 'Promote employee' }, after: { testCaseName: 'Promote direct report' }, userId: 'u1', userName: 'Sarah Chen', timestamp: '2025-03-10T14:30:00Z' },
  { id: 'aud-2', entity: 'TestStep', entityId: 'ts-13', entityName: 'HCM.ADM.384 Step 130', action: 'updated', before: { inputParameter: 'Promotion Date' }, after: { inputParameter: 'When does the promotion start...' }, userId: 'u2', userName: 'James Miller', timestamp: '2025-03-12T09:15:00Z' },
  { id: 'aud-3', entity: 'TestRun', entityId: 'run-1', entityName: 'HCM Admin Regression — R13 26A', action: 'executed', userId: 'u1', userName: 'Sarah Chen', timestamp: '2025-03-20T09:30:00Z' },
  { id: 'aud-4', entity: 'TestCase', entityId: 'tc-4', entityName: 'FIN.AP.201 — Create standard invoice', action: 'created', userId: 'u1', userName: 'Sarah Chen', timestamp: '2025-03-08T11:00:00Z' },
  { id: 'aud-5', entity: 'Application', entityId: 'app-2', entityName: 'SAP S/4HANA', action: 'created', userId: 'u2', userName: 'James Miller', timestamp: '2025-03-10T16:00:00Z' },
  { id: 'aud-6', entity: 'TestRun', entityId: 'run-2', entityName: 'Finance GL Smoke Test', action: 'executed', userId: 'u2', userName: 'James Miller', timestamp: '2025-03-21T14:00:00Z' },
];

// --- Helpers for tag-based lookups (used by sidebar and filtered views) ---
/** All test cases tagged into a given release (via releaseIds, falling back to legacy releaseId). */
export function getCasesByReleaseTag(releaseId: string): TestCase[] {
  return testCases.filter(tc =>
    (tc.releaseIds && tc.releaseIds.includes(releaseId)) ||
    (!tc.releaseIds && tc.releaseId === releaseId)
  );
}

/** All test cases tagged into a given business process. */
export function getCasesByProcess(processId: string): TestCase[] {
  return testCases.filter(tc => tc.processIds?.includes(processId));
}

/** All test cases tagged with a given label (case-insensitive). */
export function getCasesByLabel(label: string): TestCase[] {
  const l = label.toLowerCase();
  return testCases.filter(tc => tc.labels?.some(x => x.toLowerCase() === l));
}

/**
 * Unified faceted query. Every facet is optional; multi-valued facets use OR within
 * the facet and AND across facets. Use this everywhere the Library is filtered so
 * the page always has a single source of truth.
 */
export interface LibraryFilter {
  appId?: string;
  /** @deprecated single-value variant kept for the old browser API. Prefer moduleIds. */
  moduleId?: string;       // de-duped module id (any module sharing the same name in the app counts)
  /** @deprecated single-value variant kept for the old browser API. Prefer featureIds. */
  featureId?: string;
  moduleIds?: string[];    // OR within facet, AND across facets
  featureIds?: string[];
  releaseIds?: string[];
  processIds?: string[];
  labels?: string[];
  status?: Array<'valid' | 'draft' | 'archived'>;

  q?: string;
  /** When true, soft-deleted cases are included. Default false. */
  includeDeleted?: boolean;
}

/** Apply a LibraryFilter to an arbitrary array of cases. */
export function filterCases(cases: TestCase[], f: LibraryFilter = {}): TestCase[] {
  let appFeatureIds: Set<string> | null = null;
  if (f.appId) {
    const appModuleIds = new Set(modules.filter(m => m.applicationId === f.appId).map(m => m.id));
    appFeatureIds = new Set(features.filter(feat => appModuleIds.has(feat.moduleId)).map(f => f.id));
  }
  let moduleFeatureIds: Set<string> | null = null;
  if (f.moduleId) {
    const target = modules.find(m => m.id === f.moduleId);
    if (target) {
      const sameNameIds = modules
        .filter(m => m.name === target.name && (!target.applicationId || m.applicationId === target.applicationId))
        .map(m => m.id);
      moduleFeatureIds = new Set(features.filter(feat => sameNameIds.includes(feat.moduleId)).map(f => f.id));
    } else {
      moduleFeatureIds = new Set();
    }
  }
  // Multi-module: union all features of selected modules (deduped by name within app).
  let multiModuleFeatureIds: Set<string> | null = null;
  if (f.moduleIds?.length) {
    const allowed = new Set<string>();
    for (const mid of f.moduleIds) {
      const target = modules.find(m => m.id === mid);
      if (!target) continue;
      const sameNameIds = modules
        .filter(m => m.name === target.name && (!target.applicationId || m.applicationId === target.applicationId))
        .map(m => m.id);
      features.filter(feat => sameNameIds.includes(feat.moduleId)).forEach(f => allowed.add(f.id));
    }
    multiModuleFeatureIds = allowed;
  }
  const q = f.q?.trim().toLowerCase();

  return cases.filter(tc => {
    if (!f.includeDeleted && tc.deletedAt) return false;
    if (appFeatureIds && !appFeatureIds.has(tc.featureId)) return false;
    if (moduleFeatureIds && !moduleFeatureIds.has(tc.featureId)) return false;
    if (multiModuleFeatureIds && !multiModuleFeatureIds.has(tc.featureId)) return false;
    if (f.featureId && tc.featureId !== f.featureId) return false;
    if (f.featureIds?.length && !f.featureIds.includes(tc.featureId)) return false;
    if (f.releaseIds?.length) {
      const tcReleases = tc.releaseIds ?? [tc.releaseId];
      if (!f.releaseIds.some(rid => tcReleases.includes(rid))) return false;
    }
    if (f.processIds?.length) {
      if (!tc.processIds || !f.processIds.some(pid => tc.processIds!.includes(pid))) return false;
    }
    if (f.labels?.length) {
      if (!tc.labels || !f.labels.some(l => tc.labels!.includes(l))) return false;
    }
    if (f.status?.length && !f.status.includes(tc.status)) return false;

    if (q) {
      const hay = `${tc.caseNumber} ${tc.testCaseName} ${tc.role} ${(tc.labels ?? []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function filterTestCases(f: LibraryFilter = {}): TestCase[] {
  return filterCases(testCases, f);
}

/** All distinct labels currently in use, with their usage counts. */
export const labelCounts: Array<{ label: string; count: number }> = (() => {
  const map = new Map<string, number>();
  testCases.forEach(tc => tc.labels?.forEach(l => map.set(l, (map.get(l) ?? 0) + 1)));
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
})();

// ===========================================================================
// CLIENT REPOSITORIES — per-tenant copies with overrides + tombstones.
// ===========================================================================

export const clientRepos: ClientRepo[] = [
  { id: 'client-globex', name: 'Globex Corp',     workspaceId: 'ws-1', baselineVersion: 1, createdAt: '2025-03-01' },
  { id: 'client-initech', name: 'Initech',        workspaceId: 'ws-1', baselineVersion: 1, createdAt: '2025-03-08' },
  { id: 'client-umbrella', name: 'Umbrella Inc.', workspaceId: 'ws-1', baselineVersion: 1, createdAt: '2025-03-20' },
];

/** Mutable in-memory store. Real implementation will be the customization API. */
export const clientOverrides: Record<string, TestCaseOverride[]> = {
  'client-globex': [],
  'client-initech': [],
  'client-umbrella': [],
};

export const clientTombstones: Record<string, TestCaseTombstone[]> = {
  'client-globex': [],
  'client-initech': [],
  'client-umbrella': [],
};

// --- Seed Globex with a meaningful customization footprint ---------------
function seedGlobex() {
  const tc1 = testCases.find(tc => tc.caseNumber === 'HCM.ADM.384');
  if (tc1) {
    const customId = `${tc1.id}__client-globex`;
    const customised: TestCase = {
      ...tc1, id: customId,
      testCaseName: 'Promote direct report (Globex variant)',
      role: 'Manager, HR Specialist, Compensation Analyst',
      description: 'Globex-specific promotion flow with extra compensation review step.',
      labels: [...(tc1.labels ?? []), 'globex-custom'],
      version: 1, updatedAt: '2025-04-12',
    };
    const baseSteps = testSteps.filter(s => s.testCaseId === tc1.id);
    const customSteps: TestStep[] = baseSteps.map(s => ({ ...s, id: `${s.id}__globex`, testCaseId: customId }));
    customSteps.splice(3, 0, {
      id: `ts-globex-${tc1.id}-comp`, testCaseId: customId, lineNumber: 35,
      stepDescription: 'Click on Compensation Review', inputParameter: 'Compensation Review',
      action: 'click_link', validationType: 'not_applicable', validationName: 'Not Applicable',
      uniqueMandatory: 'mandatory', dataType: 'not_applicable', testingType: 'positive',
    });
    clientOverrides['client-globex'].push({
      id: `ovr-globex-${tc1.id}`, clientRepoId: 'client-globex',
      originCaseId: tc1.id, originVersion: 1,
      testCase: customised, steps: customSteps,
    });
  }

  const tc4 = testCases.find(tc => tc.caseNumber === 'FIN.AP.201');
  if (tc4) {
    const customId = `${tc4.id}__client-globex`;
    const customised: TestCase = {
      ...tc4, id: customId,
      testCaseName: 'Create standard invoice — Globex AP rules',
      description: 'Globex AP invoice creation including custom WHT codes.',
      labels: [...(tc4.labels ?? []), 'globex-custom'],
      version: 1, updatedAt: '2025-04-15',
    };
    const baseSteps = testSteps.filter(s => s.testCaseId === tc4.id);
    clientOverrides['client-globex'].push({
      id: `ovr-globex-${tc4.id}`, clientRepoId: 'client-globex',
      originCaseId: tc4.id, originVersion: 1,
      testCase: customised,
      steps: baseSteps.map(s => ({ ...s, id: `${s.id}__globex`, testCaseId: customId })),
    });
  }

  for (let i = 1; i <= 5; i++) {
    const id = `tc-globex-new-${i}`;
    clientOverrides['client-globex'].push({
      id: `ovr-globex-new-${i}`, clientRepoId: 'client-globex',
      testCase: {
        id, caseNumber: `GLOBEX.REC.${String(i).padStart(3, '0')}`,
        testCaseName: `Globex onboarding extension #${i}`,
        featureId: 'feat-3', moduleId: 'mod-1',
        releaseId: 'rel-1', releaseIds: ['rel-1'], processIds: ['proc-1'],
        labels: ['globex-custom', 'regression'], role: 'Recruiter',
        description: 'Globex-only onboarding sub-flow not present in master.',
        type: 'customized', status: 'valid', order: 1000 + i, version: 1,
        createdAt: '2025-04-10', updatedAt: '2025-04-10',
      },
      steps: [],
    });
  }

  const tc6 = testCases.find(tc => tc.caseNumber === 'FIN.GL.302');
  if (tc6) clientTombstones['client-globex'].push({
    clientRepoId: 'client-globex', originCaseId: tc6.id, deletedAt: '2025-04-08',
  });
  const tc3 = testCases.find(tc => tc.caseNumber === 'HCM.BEN.101');
  if (tc3) clientTombstones['client-globex'].push({
    clientRepoId: 'client-globex', originCaseId: tc3.id, deletedAt: '2025-04-09',
  });
}
seedGlobex();

// --- Resolution helpers --------------------------------------------------

export function resolveCases(repoId: RepoId): TestCase[] {
  if (repoId === 'master') return testCases;
  const overrides = clientOverrides[repoId] ?? [];
  const tombstones = new Set((clientTombstones[repoId] ?? []).map(t => t.originCaseId));
  const overrideByOrigin = new Map<string, TestCaseOverride>();
  const newOnly: TestCaseOverride[] = [];
  for (const o of overrides) {
    if (o.originCaseId) overrideByOrigin.set(o.originCaseId, o);
    else newOnly.push(o);
  }
  const result: TestCase[] = [];
  for (const m of testCases) {
    if (tombstones.has(m.id)) continue;
    const ovr = overrideByOrigin.get(m.id);
    result.push(ovr ? ovr.testCase : m);
  }
  for (const o of newOnly) result.push(o.testCase);
  return result;
}

export function resolveSteps(repoId: RepoId, caseId: string): TestStep[] {
  if (repoId === 'master') return testSteps.filter(s => s.testCaseId === caseId);
  const overrides = clientOverrides[repoId] ?? [];
  const direct = overrides.find(o => o.testCase.id === caseId);
  if (direct) return direct.steps;
  return testSteps.filter(s => s.testCaseId === caseId);
}

export function resolveCase(repoId: RepoId, caseId: string): TestCase | undefined {
  if (repoId === 'master') return testCases.find(tc => tc.id === caseId);
  const overrides = clientOverrides[repoId] ?? [];
  const tombstones = new Set((clientTombstones[repoId] ?? []).map(t => t.originCaseId));
  const direct = overrides.find(o => o.testCase.id === caseId);
  if (direct) return direct.testCase;
  if (tombstones.has(caseId)) return undefined;
  const ovr = overrides.find(o => o.originCaseId === caseId);
  if (ovr) return ovr.testCase;
  return testCases.find(tc => tc.id === caseId);
}

export type CaseOriginKind = 'master' | 'inherited' | 'modified' | 'client-only';

export function getCaseOrigin(repoId: RepoId, caseId: string): CaseOriginKind {
  if (repoId === 'master') return 'master';
  const overrides = clientOverrides[repoId] ?? [];
  const direct = overrides.find(o => o.testCase.id === caseId);
  if (direct) return direct.originCaseId ? 'modified' : 'client-only';
  const ovr = overrides.find(o => o.originCaseId === caseId);
  if (ovr) return 'modified';
  return 'inherited';
}

export function findOverride(repoId: RepoId, caseId: string): TestCaseOverride | undefined {
  if (repoId === 'master') return undefined;
  const overrides = clientOverrides[repoId] ?? [];
  return overrides.find(o => o.testCase.id === caseId)
      ?? overrides.find(o => o.originCaseId === caseId);
}

// --- Mutations (in-memory; will be replaced by API calls) ---------------

export function customizeCase(repoId: RepoId, masterCaseId: string): TestCaseOverride | undefined {
  if (repoId === 'master') return undefined;
  const existing = findOverride(repoId, masterCaseId);
  if (existing) return existing;
  const master = testCases.find(tc => tc.id === masterCaseId);
  if (!master) return undefined;
  const customId = `${master.id}__${repoId}`;
  const ovr: TestCaseOverride = {
    id: `ovr-${repoId}-${master.id}`,
    clientRepoId: repoId,
    originCaseId: master.id,
    originVersion: master.version ?? 1,
    testCase: { ...master, id: customId, updatedAt: new Date().toISOString().slice(0, 10) },
    steps: testSteps.filter(s => s.testCaseId === master.id).map(s => ({ ...s, id: `${s.id}__${repoId}`, testCaseId: customId })),
  };
  (clientOverrides[repoId] ||= []).push(ovr);
  return ovr;
}

export function revertCase(repoId: RepoId, caseId: string): boolean {
  if (repoId === 'master') return false;
  const arr = clientOverrides[repoId];
  if (!arr) return false;
  const idx = arr.findIndex(o => o.testCase.id === caseId || o.originCaseId === caseId);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  return true;
}

export function deleteInheritedCase(repoId: RepoId, masterCaseId: string): boolean {
  if (repoId === 'master') return false;
  revertCase(repoId, masterCaseId);
  const tombs = (clientTombstones[repoId] ||= []);
  if (tombs.some(t => t.originCaseId === masterCaseId)) return false;
  tombs.push({ clientRepoId: repoId, originCaseId: masterCaseId, deletedAt: new Date().toISOString().slice(0, 10) });
  return true;
}

// --- Diff -----------------------------------------------------------------

export function diffRepo(
  repoId: RepoId,
  scopePredicate: (tc: TestCase) => boolean = () => true,
): CaseDiffEntry[] {
  if (repoId === 'master') return [];
  const overrides = clientOverrides[repoId] ?? [];
  const tombstones = new Set((clientTombstones[repoId] ?? []).map(t => t.originCaseId));
  const overrideByOrigin = new Map<string, TestCaseOverride>();
  const newOnly: TestCaseOverride[] = [];
  for (const o of overrides) {
    if (o.originCaseId) overrideByOrigin.set(o.originCaseId, o);
    else newOnly.push(o);
  }
  const out: CaseDiffEntry[] = [];

  for (const m of testCases) {
    if (!scopePredicate(m)) continue;
    if (tombstones.has(m.id)) {
      out.push({ status: 'deleted', caseNumber: m.caseNumber, testCaseName: m.testCaseName,
        rowId: m.id, masterCase: m });
      continue;
    }
    const ovr = overrideByOrigin.get(m.id);
    if (ovr) {
      out.push({
        status: 'modified', caseNumber: m.caseNumber, testCaseName: ovr.testCase.testCaseName,
        rowId: m.id, masterCase: m, clientCase: ovr.testCase,
        driftFromMaster: (m.version ?? 1) > (ovr.originVersion ?? 1),
      });
    } else {
      out.push({ status: 'unchanged', caseNumber: m.caseNumber, testCaseName: m.testCaseName,
        rowId: m.id, masterCase: m, clientCase: m });
    }
  }
  for (const o of newOnly) {
    if (!scopePredicate(o.testCase)) continue;
    out.push({ status: 'new', caseNumber: o.testCase.caseNumber, testCaseName: o.testCase.testCaseName,
      rowId: o.testCase.id, clientCase: o.testCase });
  }
  return out;
}

// --- Publish history (in-memory; will be replaced by API persistence) ----

export const publishHistory: PublishRecord[] = [
  {
    id: 'ph-seed-1',
    clientRepoId: 'client-globex',
    clientName: 'Globex Corp',
    toBaselineVersion: 1,
    added: 142, removed: 0, protectedCount: 0,
    at: '2025-03-01T10:00:00.000Z',
    by: 'system',
  },
  {
    id: 'ph-seed-2',
    clientRepoId: 'client-initech',
    clientName: 'Initech',
    toBaselineVersion: 1,
    added: 142, removed: 0, protectedCount: 0,
    at: '2025-03-08T10:00:00.000Z',
    by: 'system',
  },
];

export function appendPublishRecord(rec: PublishRecord) {
  publishHistory.unshift(rec);
}

// --- Build hierarchy tree dynamically ---
// Application → Module (deduped by name within an app) → Feature

function buildHierarchyTree(): HierarchyNode[] {
  return applications.map(app => {
    // De-dupe modules by name within an application (so HCM doesn't appear twice for two releases).
    const appModules = modules.filter(m => m.applicationId === app.id);
    const seenNames = new Set<string>();
    const uniqueModules: Module[] = [];
    for (const m of appModules) {
      if (!seenNames.has(m.name)) {
        seenNames.add(m.name);
        uniqueModules.push(m);
      }
    }

    return {
      id: app.id,
      name: app.name,
      type: 'application' as const,
      children: uniqueModules.map(mod => {
        // Aggregate features across all modules with this name in this app.
        const sameNameModuleIds = appModules.filter(m => m.name === mod.name).map(m => m.id);
        const modFeatures = features.filter(f => sameNameModuleIds.includes(f.moduleId));
        const featureCaseCount = (featId: string) => testCases.filter(tc => tc.featureId === featId).length;
        const moduleCaseCount = modFeatures.reduce((sum, f) => sum + featureCaseCount(f.id), 0);
        return {
          id: mod.id,
          name: mod.name,
          type: 'module' as const,
          count: moduleCaseCount,
          children: modFeatures.map(feat => ({
            id: feat.id,
            name: feat.name,
            type: 'feature' as const,
            count: featureCaseCount(feat.id),
          })),
        };
      }),
    };
  });
}

export const hierarchyTree: HierarchyNode[] = buildHierarchyTree();

// Action type options for step builder
export const actionTypeOptions: { value: string; label: string }[] = [
  { value: 'login_into_application', label: 'Login Into Application' },
  { value: 'click_icon', label: 'Click Icon' },
  { value: 'click_link', label: 'Click Link' },
  { value: 'click_button', label: 'Click Button' },
  { value: 'enter_value_text_field', label: 'Enter Value - Text Field' },
  { value: 'enter_value_text_field_oj', label: 'Enter Value Text Field(Oj)' },
  { value: 'key_enter', label: 'Key - Enter' },
  { value: 'key_tab', label: 'Key - Tab' },
  { value: 'wait_till_load', label: 'Wait Till Load' },
  { value: 'date_picker', label: 'Date Picker' },
  { value: 'select_dropdown', label: 'Select Dropdown' },
  { value: 'scroll_down', label: 'Scroll Down' },
  { value: 'navigate_to_url', label: 'Navigate To URL' },
  { value: 'validate_text', label: 'Validate Text' },
  { value: 'validate_element', label: 'Validate Element' },
];

export const validationTypeOptions: { value: string; label: string }[] = [
  { value: 'not_applicable', label: 'Not Applicable' },
  { value: 'validation_from_application', label: 'Validation From Application' },
  { value: 'format_expression', label: 'Format Expression' },
];

export const dataTypeOptions: { value: string; label: string }[] = [
  { value: 'not_applicable', label: 'Not Applicable' },
  { value: 'alpha_numeric', label: 'Alpha - Numeric' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'date', label: 'Date' },
  { value: 'text', label: 'Text' },
];

// Mock screenshots for run reports
export const runScreenshots: RunScreenshot[] = (() => {
  const screenshots: RunScreenshot[] = [];
  const stages = ['Login Page', 'Dashboard Loaded', 'Navigation to Module', 'Form Entry', 'Validation Check', 'Submit Confirmation', 'Result Screen'];
  const colors = ['#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'];
  let idx = 0;
  testRuns.forEach(run => {
    const casesForRun = testCases.filter(tc => !run.selectedCaseIds || run.selectedCaseIds.includes(tc.id)).slice(0, 3);
    casesForRun.forEach(tc => {
      const stepsForCase = testSteps.filter(s => s.testCaseId === tc.id).slice(0, 4);
      stepsForCase.forEach((step, si) => {
        const stageIdx = (idx + si) % stages.length;
        screenshots.push({
          id: `ss-${idx++}`,
          runId: run.id,
          testCaseId: tc.id,
          stepId: step.id,
          url: `/placeholder.svg`,
          label: stages[stageIdx],
          timestamp: new Date(Date.parse(run.startedAt) + si * 15000).toISOString(),
        });
      });
    });
  });
  return screenshots;
})();

// --- Teams ---
export const teams: Team[] = [
  {
    id: 'team-1', name: 'Finance - Accounts Payable', color: '#3b82f6', workspaceId: 'ws-1',
    description: 'AP invoice processing, payments, and vendor management',
    members: [
      { userId: 'u1', name: 'Sarah Chen', email: 'sarah@acme.com', role: 'lead' },
      { userId: 'u2', name: 'James Miller', email: 'james@acme.com', role: 'member' },
    ],
    createdAt: '2025-02-01',
  },
  {
    id: 'team-2', name: 'Finance - General Ledger', color: '#8b5cf6', workspaceId: 'ws-1',
    description: 'GL journal entries, period close, and financial reporting',
    members: [
      { userId: 'u2', name: 'James Miller', email: 'james@acme.com', role: 'lead' },
      { userId: 'u4', name: 'Alex Kim', email: 'alex@acme.com', role: 'member' },
    ],
    createdAt: '2025-02-01',
  },
  {
    id: 'team-3', name: 'HR Operations', color: '#22c55e', workspaceId: 'ws-1',
    description: 'HCM administration, benefits, and recruitment testing',
    members: [
      { userId: 'u3', name: 'Priya Patel', email: 'priya@acme.com', role: 'lead' },
      { userId: 'u1', name: 'Sarah Chen', email: 'sarah@acme.com', role: 'member' },
    ],
    createdAt: '2025-02-15',
  },
];

// --- Run Templates ---
export const runTemplates: RunTemplate[] = [
  {
    id: 'tpl-1', name: 'AP Invoice Regression Suite',
    description: 'Full regression for AP invoice processing including create, approve, match, and payment',
    releaseId: 'rel-1', moduleId: 'mod-2', environment: 'qa',
    selectedCaseIds: testCases.filter(tc => tc.featureId === 'feat-4').slice(0, 30).map(tc => tc.id),
    teamId: 'team-1', createdBy: 'Sarah Chen', createdAt: '2025-03-01',
  },
  {
    id: 'tpl-2', name: 'GL Month-End Close',
    description: 'Month-end close cycle: journal entries, accruals, reconciliation, and reporting',
    releaseId: 'rel-1', moduleId: 'mod-2', environment: 'uat',
    selectedCaseIds: testCases.filter(tc => tc.featureId === 'feat-5').slice(0, 25).map(tc => tc.id),
    teamId: 'team-2', createdBy: 'James Miller', createdAt: '2025-03-05',
  },
  {
    id: 'tpl-3', name: 'HCM Admin Smoke Test',
    description: 'Quick smoke test for core HCM admin functions: promote, transfer, terminate',
    releaseId: 'rel-1', moduleId: 'mod-1', environment: 'qa',
    selectedCaseIds: ['tc-1', 'tc-2', 'tc-3'],
    teamId: 'team-3', createdBy: 'Priya Patel', createdAt: '2025-03-10',
  },
  {
    id: 'tpl-4', name: 'SCM Purchase Order Cycle',
    description: 'End-to-end purchase order lifecycle: create, approve, receive, and close',
    releaseId: 'rel-1', moduleId: 'mod-3', environment: 'qa',
    selectedCaseIds: testCases.filter(tc => tc.featureId === 'feat-6').slice(0, 20).map(tc => tc.id),
    createdBy: 'Alex Kim', createdAt: '2025-03-12',
  },
];

// ===========================================================================
// Inline-create helpers for the New Test Case dialog and Bulk Move dialog.
// Mock-only: mutate the in-memory arrays so the rest of the app can see them.
// ===========================================================================

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createModule(input: { name: string; applicationId: string }): Module {
  const m: Module = { id: uid('mod'), name: input.name.trim(), applicationId: input.applicationId };
  modules.unshift(m);
  return m;
}

export function createFeature(input: { name: string; moduleId: string }): Feature {
  const f: Feature = { id: uid('feat'), name: input.name.trim(), moduleId: input.moduleId };
  features.unshift(f);
  return f;
}

export function createRelease(input: { name: string; version: string; applicationId: string }): Release {
  const r: Release = {
    id: uid('rel'),
    name: input.name.trim(),
    version: input.version.trim() || input.name.trim(),
    applicationId: input.applicationId,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  releases.unshift(r);
  return r;
}

export function createProcess(input: { name: string; applicationId?: string; description?: string }): Process {
  const p: Process = {
    id: uid('proc'),
    name: input.name.trim(),
    applicationId: input.applicationId,
    description: input.description,
  };
  processes.unshift(p);
  return p;
}

export function addLabelToVocabulary(label: string): void {
  const v = label.trim();
  if (v && !labelVocabulary.includes(v)) labelVocabulary.push(v);
}

export type BulkUpdateMode = 'add' | 'remove' | 'replace';

export interface BulkUpdatePatch {
  releaseIds?: string[];
  moduleId?: string;
  featureId?: string;
  processIds?: string[];
  labels?: string[];
  status?: TestCase['status'];
}

/**
 * Apply a bulk update to the in-memory test case store.
 * Returns the count of cases mutated.
 */
export function bulkUpdateCases(
  ids: string[],
  patch: BulkUpdatePatch,
  mode: BulkUpdateMode = 'replace',
): number {
  const idSet = new Set(ids);
  let count = 0;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    if (!idSet.has(tc.id)) continue;
    const next: TestCase = { ...tc };

    if (patch.releaseIds) {
      const cur = new Set(tc.releaseIds ?? [tc.releaseId]);
      if (mode === 'add') patch.releaseIds.forEach(r => cur.add(r));
      else if (mode === 'remove') patch.releaseIds.forEach(r => cur.delete(r));
      else cur.clear(), patch.releaseIds.forEach(r => cur.add(r));
      const arr = Array.from(cur);
      next.releaseIds = arr.length ? arr : [tc.releaseId];
      // Keep primary releaseId valid (first item, or unchanged if still present).
      if (!arr.includes(next.releaseId)) next.releaseId = arr[0] ?? tc.releaseId;
    }

    if (patch.processIds) {
      const cur = new Set(tc.processIds ?? []);
      if (mode === 'add') patch.processIds.forEach(p => cur.add(p));
      else if (mode === 'remove') patch.processIds.forEach(p => cur.delete(p));
      else cur.clear(), patch.processIds.forEach(p => cur.add(p));
      next.processIds = Array.from(cur);
    }

    if (patch.labels) {
      const cur = new Set(tc.labels ?? []);
      if (mode === 'add') patch.labels.forEach(l => cur.add(l));
      else if (mode === 'remove') patch.labels.forEach(l => cur.delete(l));
      else cur.clear(), patch.labels.forEach(l => cur.add(l));
      next.labels = Array.from(cur);
    }

    if (patch.moduleId) next.moduleId = patch.moduleId;
    if (patch.featureId) next.featureId = patch.featureId;
    if (patch.status) next.status = patch.status;

    next.updatedAt = new Date().toISOString().slice(0, 10);
    testCases[i] = next;
    count++;
  }

  return count;
}

// ===========================================================================
// SOFT-DELETE / UPDATE / SNAPSHOT — admin helpers
// All mutations bump no global state; callers should call bumpRepoVersion().
// ===========================================================================

/** Patch a single test case. Pass `null` for a tag array to clear it. */
export interface CasePatch {
  testCaseName?: string;
  role?: string;
  description?: string;
  dependency?: string | null;
  status?: TestCase['status'];
  moduleId?: string;
  featureId?: string;
  releaseIds?: string[];
  processIds?: string[];
  labels?: string[];
  caseNumber?: string;
}

export function updateCase(id: string, patch: CasePatch): TestCase | undefined {
  const idx = testCases.findIndex(tc => tc.id === id);
  if (idx === -1) return undefined;
  const cur = testCases[idx];
  const next: TestCase = { ...cur };
  if (patch.testCaseName !== undefined) next.testCaseName = patch.testCaseName;
  if (patch.role !== undefined)         next.role = patch.role;
  if (patch.description !== undefined)  next.description = patch.description;
  if (patch.dependency !== undefined)   next.dependency = patch.dependency ?? undefined;
  if (patch.status !== undefined)       next.status = patch.status;
  if (patch.moduleId !== undefined)     next.moduleId = patch.moduleId;
  if (patch.featureId !== undefined)    next.featureId = patch.featureId;
  if (patch.caseNumber !== undefined)   next.caseNumber = patch.caseNumber;
  if (patch.releaseIds) {
    next.releaseIds = patch.releaseIds.length ? patch.releaseIds : [cur.releaseId];
    if (!next.releaseIds.includes(next.releaseId)) next.releaseId = next.releaseIds[0];
  }
  if (patch.processIds) next.processIds = patch.processIds;
  if (patch.labels)     next.labels = patch.labels;
  next.updatedAt = new Date().toISOString().slice(0, 10);
  testCases[idx] = next;
  return next;
}

export function softDeleteCase(id: string): boolean {
  const idx = testCases.findIndex(tc => tc.id === id);
  if (idx === -1 || testCases[idx].deletedAt) return false;
  testCases[idx] = { ...testCases[idx], deletedAt: new Date().toISOString() };
  return true;
}

export function restoreCase(id: string): boolean {
  const idx = testCases.findIndex(tc => tc.id === id);
  if (idx === -1 || !testCases[idx].deletedAt) return false;
  const { deletedAt: _omit, ...rest } = testCases[idx];
  testCases[idx] = rest as TestCase;
  return true;
}

/** Per-app sequence counter for deterministic case numbering. */
const caseSeqByApp: Record<string, number> = {};
function nextSeq(appId: string): number {
  if (caseSeqByApp[appId] === undefined) {
    // Seed from the highest existing numeric suffix in this app.
    const appModuleIds = new Set(modules.filter(m => m.applicationId === appId).map(m => m.id));
    const featuresInApp = new Set(features.filter(f => appModuleIds.has(f.moduleId)).map(f => f.id));
    let max = 0;
    for (const tc of testCases) {
      if (!featuresInApp.has(tc.featureId)) continue;
      const m = tc.caseNumber.match(/(\d+)\s*$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    caseSeqByApp[appId] = max;
  }
  caseSeqByApp[appId] += 1;
  return caseSeqByApp[appId];
}

/** Build a deterministic case number: <APP-INITIALS>.<MODULE-PREFIX>.<seq> */
export function generateCaseNumber(appId: string, moduleId?: string): string {
  const app = applications.find(a => a.id === appId);
  const appPrefix = (app?.name ?? 'NEW').split(/\s+/).map(w => w[0] ?? '').join('').toUpperCase().slice(0, 3) || 'APP';
  const mod = moduleId ? modules.find(m => m.id === moduleId) : undefined;
  const modPrefix = (mod?.name ?? 'GEN').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'GEN';
  const n = nextSeq(appId);
  return `${appPrefix}.${modPrefix}.${String(n).padStart(3, '0')}`;
}

export function isCaseNumberTaken(num: string): boolean {
  const n = num.trim().toLowerCase();
  return testCases.some(tc => tc.caseNumber.toLowerCase() === n);
}

export function duplicateCase(id: string): TestCase | undefined {
  const src = testCases.find(tc => tc.id === id);
  if (!src) return undefined;
  const mod = modules.find(m => m.id === src.moduleId);
  const appId = mod?.applicationId ?? applications[0]?.id ?? 'app-1';
  const newId = `tc-dup-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const today = new Date().toISOString().slice(0, 10);
  const copy: TestCase = {
    ...src,
    id: newId,
    caseNumber: generateCaseNumber(appId, src.moduleId),
    testCaseName: `${src.testCaseName} (copy)`,
    version: 1,
    createdAt: today,
    updatedAt: today,
    deletedAt: undefined,
  };
  testCases.unshift(copy);
  // Clone steps too.
  const srcSteps = testSteps.filter(s => s.testCaseId === id);
  for (const s of srcSteps) {
    testSteps.push({ ...s, id: `${s.id}__dup-${Date.now()}-${s.lineNumber}`, testCaseId: newId });
  }
  return copy;
}

// --- Taxonomy mutations --------------------------------------------------

export type TaxonomyKind = 'module' | 'feature' | 'release' | 'process';

function taxonomyArray(kind: TaxonomyKind):
  Module[] | Feature[] | Release[] | Process[] {
  switch (kind) {
    case 'module':  return modules;
    case 'feature': return features;
    case 'release': return releases;
    case 'process': return processes;
  }
}

export function renameEntity(kind: TaxonomyKind, id: string, name: string): boolean {
  const arr = taxonomyArray(kind) as Array<{ id: string; name: string }>;
  const found = arr.find(e => e.id === id);
  if (!found) return false;
  found.name = name.trim();
  return true;
}

/** Reassign all test-case references from `fromId` to `intoId`. Returns count. */
export function reassignReferences(kind: TaxonomyKind, fromId: string, intoId: string): number {
  let n = 0;
  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    let changed = false;
    const next: TestCase = { ...tc };
    if (kind === 'module' && tc.moduleId === fromId)   { next.moduleId = intoId; changed = true; }
    if (kind === 'feature' && tc.featureId === fromId) { next.featureId = intoId; changed = true; }
    if (kind === 'release') {
      const ids = new Set(tc.releaseIds ?? [tc.releaseId]);
      if (ids.has(fromId)) {
        ids.delete(fromId); ids.add(intoId);
        next.releaseIds = Array.from(ids);
        if (next.releaseId === fromId) next.releaseId = intoId;
        changed = true;
      }
    }
    if (kind === 'process') {
      const ids = new Set(tc.processIds ?? []);
      if (ids.has(fromId)) {
        ids.delete(fromId); ids.add(intoId);
        next.processIds = Array.from(ids);
        changed = true;
      }
    }
    if (changed) { next.updatedAt = new Date().toISOString().slice(0, 10); testCases[i] = next; n++; }
  }
  return n;
}

export function getEntityUsage(kind: TaxonomyKind, id: string): { active: number; deleted: number } {
  let active = 0, deleted = 0;
  for (const tc of testCases) {
    let hit = false;
    if (kind === 'module'  && tc.moduleId === id)  hit = true;
    if (kind === 'feature' && tc.featureId === id) hit = true;
    if (kind === 'release' && (tc.releaseIds ?? [tc.releaseId]).includes(id)) hit = true;
    if (kind === 'process' && (tc.processIds ?? []).includes(id)) hit = true;
    if (!hit) continue;
    if (tc.deletedAt) deleted++; else active++;
  }
  return { active, deleted };
}

export function softDeleteEntity(kind: TaxonomyKind, id: string, reassignTo?: string): boolean {
  const usage = getEntityUsage(kind, id);
  if (usage.active > 0) {
    if (!reassignTo) return false;
    reassignReferences(kind, id, reassignTo);
  }
  const arr = taxonomyArray(kind) as Array<{ id: string; deletedAt?: string }>;
  const ent = arr.find(e => e.id === id);
  if (!ent) return false;
  ent.deletedAt = new Date().toISOString();
  return true;
}

export function restoreEntity(kind: TaxonomyKind, id: string): boolean {
  const arr = taxonomyArray(kind) as Array<{ id: string; deletedAt?: string }>;
  const ent = arr.find(e => e.id === id);
  if (!ent || !ent.deletedAt) return false;
  delete ent.deletedAt;
  return true;
}

export function mergeEntity(kind: TaxonomyKind, fromId: string, intoId: string): { reassigned: number } {
  if (fromId === intoId) return { reassigned: 0 };
  const reassigned = reassignReferences(kind, fromId, intoId);
  softDeleteEntity(kind, fromId);
  return { reassigned };
}

// --- Label vocabulary mutations -----------------------------------------

export const deletedLabels = new Set<string>();

export function renameLabel(oldLabel: string, nextLabel: string): number {
  const o = oldLabel.trim();
  const n = nextLabel.trim();
  if (!o || !n || o === n) return 0;
  const idx = labelVocabulary.indexOf(o);
  if (idx >= 0) labelVocabulary[idx] = n;
  if (!labelVocabulary.includes(n)) labelVocabulary.push(n);
  let count = 0;
  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    if (!tc.labels?.includes(o)) continue;
    testCases[i] = { ...tc, labels: tc.labels.map(l => (l === o ? n : l)) };
    count++;
  }
  return count;
}

export function softDeleteLabel(label: string): void {
  deletedLabels.add(label);
}
export function restoreLabel(label: string): void {
  deletedLabels.delete(label);
}
export function getLabelUsage(label: string): { active: number; deleted: number } {
  let active = 0, deleted = 0;
  for (const tc of testCases) {
    if (!tc.labels?.includes(label)) continue;
    if (tc.deletedAt) deleted++; else active++;
  }
  return { active, deleted };
}

// --- Snapshots / undo ----------------------------------------------------

interface CaseSnapshot { idx: number; case: TestCase }
const snapshots = new Map<string, CaseSnapshot[]>();

export function snapshotCases(ids: string[]): string {
  const token = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const idSet = new Set(ids);
  const items: CaseSnapshot[] = [];
  for (let i = 0; i < testCases.length; i++) {
    if (idSet.has(testCases[i].id)) items.push({ idx: i, case: { ...testCases[i] } });
  }
  snapshots.set(token, items);
  return token;
}

export function restoreSnapshot(token: string): number {
  const items = snapshots.get(token);
  if (!items) return 0;
  for (const { idx, case: c } of items) {
    if (testCases[idx]?.id === c.id) testCases[idx] = c;
    else {
      const altIdx = testCases.findIndex(tc => tc.id === c.id);
      if (altIdx >= 0) testCases[altIdx] = c;
    }
  }
  snapshots.delete(token);
  return items.length;
}

export function bulkSoftDelete(ids: string[]): number {
  let n = 0;
  for (const id of ids) if (softDeleteCase(id)) n++;
  return n;
}

// --- Publish snapshots / rollback ---------------------------------------

interface PublishSnapshot {
  perClient: Record<string, {
    overrides: TestCaseOverride[];
    tombstones: TestCaseTombstone[];
    baselineVersion: number;
  }>;
}
const publishSnapshots = new Map<string, PublishSnapshot>();

export function snapshotClientState(clientId: string): string {
  const token = `pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const repo = clientRepos.find(c => c.id === clientId);
  publishSnapshots.set(token, {
    perClient: {
      [clientId]: {
        overrides: (clientOverrides[clientId] ?? []).map(o => ({ ...o, steps: o.steps.map(s => ({ ...s })) })),
        tombstones: (clientTombstones[clientId] ?? []).map(t => ({ ...t })),
        baselineVersion: repo?.baselineVersion ?? 1,
      },
    },
  });
  return token;
}

export function restorePublishSnapshot(token: string): boolean {
  const snap = publishSnapshots.get(token);
  if (!snap) return false;
  for (const [clientId, state] of Object.entries(snap.perClient)) {
    clientOverrides[clientId] = state.overrides;
    clientTombstones[clientId] = state.tombstones;
    const repo = clientRepos.find(c => c.id === clientId);
    if (repo) repo.baselineVersion = state.baselineVersion;
  }
  publishSnapshots.delete(token);
  return true;
}

export function removePublishRecord(id: string): boolean {
  const idx = publishHistory.findIndex(r => r.id === id);
  if (idx === -1) return false;
  publishHistory.splice(idx, 1);
  return true;
}
