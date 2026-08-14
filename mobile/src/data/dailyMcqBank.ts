export type DailyMcqQuestion = {
  id: string;
  subject: 'Accounts' | 'Law' | 'Taxation' | 'Costing' | 'Audit' | 'FM' | 'SM';
  prompt: string;
  options: [string, string, string, string];
  answer: number;
  explanation: string;
};

// Safe preview content only. These stable foundation questions demonstrate the
// product flow; a mentor-approved and versioned bank must replace them before
// learners rely on the app for exam preparation.
export const dailyMcqBank: DailyMcqQuestion[] = [
  {
    id: 'acc-equation', subject: 'Accounts',
    prompt: 'Which equation is the foundation of the double-entry accounting system?',
    options: ['Assets = Liabilities + Equity', 'Assets = Revenue − Expenses', 'Equity = Assets + Liabilities', 'Cash = Profit + Drawings'],
    answer: 0,
    explanation: 'Every recorded transaction keeps the accounting equation Assets = Liabilities + Equity in balance.',
  },
  {
    id: 'acc-accrual', subject: 'Accounts',
    prompt: 'Under accrual accounting, income is generally recognised when it is:',
    options: ['Received only in cash', 'Earned, whether or not cash is received', 'Deposited into a bank', 'Approved by an auditor'],
    answer: 1,
    explanation: 'Accrual accounting records income when earned and expenses when incurred, rather than only when cash moves.',
  },
  {
    id: 'acc-depreciation', subject: 'Accounts',
    prompt: 'Depreciation is best described as:',
    options: ['A valuation of an asset at market price', 'A cash reserve for buying an asset', 'Systematic allocation of depreciable amount over useful life', 'A record of inflation'],
    answer: 2,
    explanation: 'Depreciation allocates an asset’s depreciable amount systematically over its useful life; it is not a market valuation.',
  },
  {
    id: 'acc-trial-balance', subject: 'Accounts',
    prompt: 'Agreement of a trial balance proves that:',
    options: ['No accounting error exists', 'All transactions were authorised', 'Total debits equal total credits', 'All assets physically exist'],
    answer: 2,
    explanation: 'A balanced trial balance confirms debit-credit arithmetic, but some errors can still remain undetected.',
  },
  {
    id: 'law-contract', subject: 'Law',
    prompt: 'An agreement enforceable by law is called a:',
    options: ['Promise', 'Contract', 'Proposal', 'Representation'],
    answer: 1,
    explanation: 'The Indian Contract Act defines a contract as an agreement enforceable by law.',
  },
  {
    id: 'law-consent', subject: 'Law',
    prompt: 'Consent is said to be free when it is not caused by factors such as:',
    options: ['Offer and acceptance', 'Writing and registration', 'Coercion or undue influence', 'Performance and discharge'],
    answer: 2,
    explanation: 'Coercion, undue influence, fraud, misrepresentation and mistake are relevant factors when assessing free consent.',
  },
  {
    id: 'law-offer', subject: 'Law',
    prompt: 'A valid acceptance must generally be:',
    options: ['Absolute and unqualified', 'Different from the offer', 'Kept secret from the offeror', 'Made before the offer'],
    answer: 0,
    explanation: 'A valid acceptance should correspond to the offer and be absolute and unqualified rather than a counter-offer.',
  },
  {
    id: 'law-consideration', subject: 'Law',
    prompt: 'In contract law, consideration broadly means:',
    options: ['A social invitation', 'Something of value given in return for a promise', 'Registration fee only', 'A court penalty'],
    answer: 1,
    explanation: 'Consideration is the value or act exchanged for a promise, subject to the governing legal rules and exceptions.',
  },
  {
    id: 'tax-gst', subject: 'Taxation',
    prompt: 'GST is commonly described as a:',
    options: ['Origin-based direct tax', 'Destination-based indirect tax', 'Tax only on income', 'Tax only on imports'],
    answer: 1,
    explanation: 'GST is a destination-based indirect tax on consumption, with revenue generally accruing to the place of consumption.',
  },
  {
    id: 'tax-itc', subject: 'Taxation',
    prompt: 'The core purpose of Input Tax Credit in GST is to:',
    options: ['Increase tax cascading', 'Avoid tax-on-tax cascading', 'Replace tax invoices', 'Tax only final exports'],
    answer: 1,
    explanation: 'Eligible input tax credit offsets tax paid on inputs against output tax, reducing cascading.',
  },
  {
    id: 'tax-direct', subject: 'Taxation',
    prompt: 'Which statement generally distinguishes a direct tax?',
    options: ['Its burden is normally intended to remain on the person taxed', 'It is always collected at a retail shop', 'It applies only to goods', 'It has no statutory basis'],
    answer: 0,
    explanation: 'A direct tax is imposed directly on a person and its burden is generally not intended to be shifted to another person.',
  },
  {
    id: 'tax-year', subject: 'Taxation',
    prompt: 'In basic Indian income-tax terminology, the assessment year generally follows the:',
    options: ['Calendar decade', 'Previous year', 'Audit year only', 'Incorporation year only'],
    answer: 1,
    explanation: 'Income of the previous year is generally assessed in the immediately following assessment year, subject to statutory rules.',
  },
  {
    id: 'cost-contribution', subject: 'Costing',
    prompt: 'Contribution is calculated as:',
    options: ['Sales − Fixed cost', 'Sales − Variable cost', 'Profit + Variable cost', 'Fixed cost − Profit'],
    answer: 1,
    explanation: 'Contribution equals sales minus variable cost and first contributes toward fixed cost, then profit.',
  },
  {
    id: 'cost-bep', subject: 'Costing',
    prompt: 'Break-even point in units is generally calculated as:',
    options: ['Fixed cost ÷ Contribution per unit', 'Variable cost ÷ Selling price', 'Sales ÷ Fixed cost', 'Profit ÷ Contribution'],
    answer: 0,
    explanation: 'At break-even, total contribution equals fixed cost, so units = fixed cost divided by contribution per unit.',
  },
  {
    id: 'cost-mos', subject: 'Costing',
    prompt: 'Margin of safety is the excess of:',
    options: ['Break-even sales over actual sales', 'Actual sales over break-even sales', 'Fixed cost over contribution', 'Variable cost over sales'],
    answer: 1,
    explanation: 'Margin of safety measures how far actual or budgeted sales exceed break-even sales.',
  },
  {
    id: 'cost-variable', subject: 'Costing',
    prompt: 'Within the relevant range, variable cost per unit is generally assumed to:',
    options: ['Remain constant', 'Double every month', 'Equal fixed cost', 'Fall to zero'],
    answer: 0,
    explanation: 'CVP analysis generally assumes variable cost per unit remains constant within the relevant range.',
  },
  {
    id: 'audit-sufficiency', subject: 'Audit',
    prompt: 'In audit evidence, sufficiency primarily relates to:',
    options: ['Quantity of evidence', 'Colour of documents', 'Audit fee', 'Length of the report'],
    answer: 0,
    explanation: 'Sufficiency is the measure of quantity, while appropriateness concerns relevance and reliability (quality).',
  },
  {
    id: 'audit-appropriateness', subject: 'Audit',
    prompt: 'Appropriateness of audit evidence primarily concerns its:',
    options: ['Quantity only', 'Relevance and reliability', 'Page count', 'Preparation cost'],
    answer: 1,
    explanation: 'Appropriateness measures evidence quality through relevance and reliability.',
  },
  {
    id: 'audit-assurance', subject: 'Audit',
    prompt: 'A financial statement audit ordinarily provides:',
    options: ['Absolute assurance', 'Reasonable assurance', 'No assurance', 'A guarantee against every fraud'],
    answer: 1,
    explanation: 'Because of inherent limitations, an audit provides reasonable rather than absolute assurance.',
  },
  {
    id: 'audit-skepticism', subject: 'Audit',
    prompt: 'Professional scepticism includes:',
    options: ['Accepting all evidence without question', 'A questioning mind and alertness to possible misstatement', 'Assuming management is dishonest', 'Avoiding professional judgement'],
    answer: 1,
    explanation: 'Professional scepticism combines a questioning mind with critical assessment, without automatically assuming honesty or dishonesty.',
  },
  {
    id: 'fm-npv', subject: 'FM',
    prompt: 'Under the NPV rule, an independent project with a positive NPV is generally:',
    options: ['Rejected', 'Accepted', 'Ignored regardless of constraints', 'Treated as zero-return'],
    answer: 1,
    explanation: 'A positive NPV indicates value addition, so an independent project is generally acceptable subject to other constraints.',
  },
  {
    id: 'fm-discount', subject: 'FM',
    prompt: 'For a positive future cash flow, increasing the discount rate generally makes present value:',
    options: ['Higher', 'Lower', 'Always unchanged', 'Equal to face value'],
    answer: 1,
    explanation: 'A higher discount rate increases the denominator in present-value calculations, reducing present value.',
  },
  {
    id: 'fm-working-capital', subject: 'FM',
    prompt: 'Net working capital is commonly calculated as:',
    options: ['Current assets − Current liabilities', 'Fixed assets − Long-term debt', 'Sales − Profit', 'Equity − Cash'],
    answer: 0,
    explanation: 'Net working capital is the excess of current assets over current liabilities.',
  },
  {
    id: 'fm-irr', subject: 'FM',
    prompt: 'Internal Rate of Return is the discount rate at which project NPV becomes:',
    options: ['Maximum', 'Zero', 'Equal to sales', 'Equal to fixed cost'],
    answer: 1,
    explanation: 'IRR is the rate that equates present value of inflows and outflows, making NPV zero.',
  },
  {
    id: 'sm-swot', subject: 'SM',
    prompt: 'In SWOT analysis, opportunities and threats are generally:',
    options: ['Internal factors', 'External factors', 'Accounting entries', 'Only financial ratios'],
    answer: 1,
    explanation: 'Strengths and weaknesses are internal; opportunities and threats arise from the external environment.',
  },
  {
    id: 'sm-mission', subject: 'SM',
    prompt: 'An organisation’s mission primarily communicates its:',
    options: ['Daily cash balance', 'Fundamental purpose and reason for existence', 'Audit sample size', 'Tax rate'],
    answer: 1,
    explanation: 'A mission describes the organisation’s central purpose, identity and reason for existence.',
  },
  {
    id: 'sm-cost-leadership', subject: 'SM',
    prompt: 'A cost-leadership strategy primarily seeks competitive advantage through:',
    options: ['A lower cost position', 'Ignoring customers', 'Eliminating all controls', 'Avoiding scale'],
    answer: 0,
    explanation: 'Cost leadership aims to achieve a comparatively low cost position while delivering acceptable value.',
  },
  {
    id: 'sm-strategy', subject: 'SM',
    prompt: 'Strategy is most closely concerned with:',
    options: ['Long-term direction and allocation of resources', 'Only recording past transactions', 'Only daily attendance', 'Eliminating every uncertainty'],
    answer: 0,
    explanation: 'Strategy addresses long-term direction, choices and resource allocation in a changing environment.',
  },
];
