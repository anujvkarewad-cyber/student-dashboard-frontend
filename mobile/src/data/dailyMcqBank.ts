export type DailyMcqQuestion = {
  id: string;
  subject: 'Accounts' | 'Law' | 'Taxation' | 'Costing' | 'Audit' | 'FM' | 'SM';
  prompt: string;
  options: [string, string, string, string];
  answer: number;
  explanation: string;
  kind?: 'normal' | 'case-study';
  caseStudy?: {
    title: string;
    passage: string;
  };
  sourceRef?: string;
  applicableAttempt?: string;
};

// Safe preview content only. These original draft questions are individually
// mapped to the official ICAI BoS May 2026 module taxonomy; mentor review and
// attempt-specific amendment checks are still required before exam reliance.
export const dailyMcqBank: DailyMcqQuestion[] = [
  {
    id: 'acc-equation', subject: 'Accounts',
    prompt: 'Accounting Standards primarily help financial statements achieve greater:',
    options: ['Comparability and reliability', 'Secrecy from users', 'Freedom from all estimates', 'Replacement of every law'],
    answer: 0,
    explanation: 'Accounting Standards reduce alternative treatments and improve the comparability and reliability of financial statements.',
    sourceRef: 'Paper 1 · Module 1 · Chapter 1: Introduction to Accounting Standards', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'acc-accrual', subject: 'Accounts',
    prompt: 'Under the accrual basis used in preparing financial statements, income is generally recognised when it is:',
    options: ['Received only in cash', 'Earned, whether or not cash is received', 'Deposited into a bank', 'Approved by an auditor'],
    answer: 1,
    explanation: 'Accrual accounting records income when earned and expenses when incurred, rather than only when cash moves.',
    sourceRef: 'Paper 1 · Module 1 · Chapter 2: Framework for Preparation and Presentation of Financial Statements', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'acc-depreciation', subject: 'Accounts',
    prompt: 'Depreciation is best described as:',
    options: ['A valuation of an asset at market price', 'A cash reserve for buying an asset', 'Systematic allocation of depreciable amount over useful life', 'A record of inflation'],
    answer: 2,
    explanation: 'Depreciation allocates an asset’s depreciable amount systematically over its useful life; it is not a market valuation.',
    sourceRef: 'Paper 1 · Module 2 · Chapter 5: Assets Based Accounting Standards', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'acc-trial-balance', subject: 'Accounts',
    prompt: 'When deciding whether an Accounting Standard applies to an entity, which factor is relevant under the prescribed applicability framework?',
    options: ['The entity’s applicable classification and statutory criteria', 'The colour of its annual report', 'The auditor’s personal preference', 'The number of bank accounts only'],
    answer: 0,
    explanation: 'Applicability is determined using the prescribed entity classification, statutory framework and relevant criteria—not presentation choices or personal preference.',
    sourceRef: 'Paper 1 · Module 1 · Chapter 3: Applicability of Accounting Standards', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'law-contract', subject: 'Law',
    prompt: 'A company incorporated under the Companies Act ordinarily has a legal identity that is:',
    options: ['Separate from its members', 'Identical to its auditor', 'Valid only while every founder remains a member', 'The same as its largest shareholder'],
    answer: 0,
    explanation: 'On incorporation, a company is a separate legal person distinct from its members, subject to the Act and recognised exceptions.',
    sourceRef: 'Paper 2 · Module 1 · Chapter 1: Preliminary', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'law-consent', subject: 'Law',
    prompt: 'From the date stated in its certificate of incorporation, a registered company becomes:',
    options: ['A body corporate capable of exercising incorporated-company functions', 'A partnership until its first annual return', 'An unregistered association', 'A company only after earning revenue'],
    answer: 0,
    explanation: 'The certificate marks the company’s incorporation as a body corporate from the stated date, with the legal consequences provided by the Companies Act.',
    sourceRef: 'Paper 2 · Module 1 · Chapter 2: Incorporation of Company and Matters Incidental Thereto', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'law-offer', subject: 'Law',
    prompt: 'A rights offer of further equity shares is ordinarily made first to:',
    options: ['Existing equity shareholders in proportion to paid-up share capital', 'Only the company’s auditors', 'Only secured creditors', 'Any four members chosen at random'],
    answer: 0,
    explanation: 'Subject to the Companies Act, a rights issue offers further shares to existing equity shareholders in the prescribed proportion and manner.',
    sourceRef: 'Paper 2 · Module 1 · Chapter 4: Share Capital and Debentures', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'law-consideration', subject: 'Law',
    prompt: 'Under the General Clauses Act, repeal of an enactment ordinarily does not, unless a different intention appears:',
    options: ['Affect rights already accrued under the repealed enactment', 'Remove the repealed words from future operation', 'Permit Parliament to enact a new law', 'Require the repealing enactment to be published'],
    answer: 0,
    explanation: 'The general effect-of-repeal rule preserves previous operation, accrued rights and liabilities unless a different intention appears.',
    sourceRef: 'Paper 2 · Module 3 · Part II · Chapter 1: The General Clauses Act, 1897', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'tax-gst', subject: 'Taxation',
    prompt: 'GST is commonly described as a:',
    options: ['Origin-based direct tax', 'Destination-based indirect tax', 'Tax only on income', 'Tax only on imports'],
    answer: 1,
    explanation: 'GST is a destination-based indirect tax on consumption, with revenue generally accruing to the place of consumption.',
    sourceRef: 'Paper 3B · Module 1 · Chapter 1: GST in India - An Introduction', applicableAttempt: 'May 2026 onwards · verify statutory updates',
  },
  {
    id: 'tax-itc', subject: 'Taxation',
    prompt: 'The core purpose of Input Tax Credit in GST is to:',
    options: ['Increase tax cascading', 'Avoid tax-on-tax cascading', 'Replace tax invoices', 'Tax only final exports'],
    answer: 1,
    explanation: 'Eligible input tax credit offsets tax paid on inputs against output tax, reducing cascading.',
    sourceRef: 'Paper 3B · Module 2 · Chapter 8: Input Tax Credit', applicableAttempt: 'May 2026 onwards · verify statutory updates',
  },
  {
    id: 'tax-direct', subject: 'Taxation',
    prompt: 'Which statement generally distinguishes a direct tax?',
    options: ['Its burden is normally intended to remain on the person taxed', 'It is always collected at a retail shop', 'It applies only to goods', 'It has no statutory basis'],
    answer: 0,
    explanation: 'A direct tax is imposed directly on a person and its burden is generally not intended to be shifted to another person.',
    sourceRef: 'Paper 3A · Module 1 · Chapter 1: Basic Concepts', applicableAttempt: 'May/September 2026 and January 2027 · verify updates',
  },
  {
    id: 'tax-year', subject: 'Taxation',
    prompt: 'In basic Indian income-tax terminology, the assessment year generally follows the:',
    options: ['Calendar decade', 'Previous year', 'Audit year only', 'Incorporation year only'],
    answer: 1,
    explanation: 'Income of the previous year is generally assessed in the immediately following assessment year, subject to statutory rules.',
    sourceRef: 'Paper 3A · Module 1 · Chapter 1: Basic Concepts', applicableAttempt: 'May/September 2026 and January 2027 · verify updates',
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

  // Original case-study practice mapped to the current ICAI paper structure.
  // These are not copied ICAI questions and remain draft until mentor review.
  {
    id: 'case-g1-asset-ready', subject: 'Accounts', kind: 'case-study',
    caseStudy: {
      title: 'Case: Production machinery',
      passage: 'A company purchases machinery on 1 April. Installation and testing finish on 30 June, and the machine is ready for production on 1 July. Commercial production starts on 15 July.',
    },
    prompt: 'For accounting purposes, depreciation should generally begin when the machinery is:',
    options: ['Purchased on 1 April', 'Available for its intended use on 1 July', 'First used on 15 July only', 'Fully paid for'],
    answer: 1,
    explanation: 'Depreciation generally begins when an asset is available for use in the manner intended by management, not merely when purchased or paid for.',
    sourceRef: 'Paper 1 · Module 2 · Chapter 5: Assets Based Accounting Standards', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'case-g1-trial-error', subject: 'Accounts', kind: 'case-study',
    caseStudy: {
      title: 'Case: Short-term treasury investment',
      passage: 'A company acquires a highly liquid treasury investment with an original maturity of three months. It is readily convertible into a known amount of cash and carries an insignificant risk of change in value.',
    },
    prompt: 'For a cash flow statement, this investment is ordinarily classified as:',
    options: ['A cash equivalent', 'Inventory', 'Share capital', 'A non-cash financing activity'],
    answer: 0,
    explanation: 'A short-term, highly liquid investment meeting the convertibility and insignificant-risk conditions is ordinarily a cash equivalent.',
    sourceRef: 'Paper 1 · Module 1 · Chapter 4: Presentation & Disclosures Based Accounting Standards', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'case-g1-counter-offer', subject: 'Law', kind: 'case-study',
    caseStudy: {
      title: 'Case: Date of incorporation',
      passage: 'The promoters began preparatory work on 1 June. The Registrar issued the company’s certificate of incorporation stating 10 June as the date of incorporation.',
    },
    prompt: 'On which date does the company become a body corporate under the incorporation provision?',
    options: ['1 June', '10 June', 'Only after its first sale', 'Only after its first annual general meeting'],
    answer: 1,
    explanation: 'The company becomes a body corporate from the date of incorporation stated in the certificate, not from an earlier preparatory act.',
    sourceRef: 'Paper 2 · Module 1 · Chapter 2: Incorporation of Company and Matters Incidental Thereto', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'case-g1-free-consent', subject: 'Law', kind: 'case-study',
    caseStudy: {
      title: 'Case: Computing a statutory period',
      passage: 'A Central Act requires an act to be done within a period expressed as running “from” a specified day. No contrary intention appears.',
    },
    prompt: 'Under the General Clauses Act rule for computation of time, the specified first day is generally:',
    options: ['Excluded from the computation', 'Counted twice', 'Always treated as a public holiday', 'Included only when an auditor approves'],
    answer: 0,
    explanation: 'For a period expressed as running from a day, the General Clauses Act generally excludes that first day unless the context indicates otherwise.',
    sourceRef: 'Paper 2 · Module 3 · Part II · Chapter 1: The General Clauses Act, 1897', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'case-g1-itc', subject: 'Taxation', kind: 'case-study',
    caseStudy: {
      title: 'Case: Tax paid on inputs',
      passage: 'A registered manufacturer pays GST on eligible raw materials and later charges GST on taxable finished goods, supported by valid documents and subject to applicable conditions.',
    },
    prompt: 'What mechanism is intended to reduce cascading in this situation?',
    options: ['Input Tax Credit', 'Depreciation reserve', 'Cost audit', 'Dividend distribution'],
    answer: 0,
    explanation: 'Eligible input tax credit can offset tax paid on inputs against output tax, subject to statutory conditions and attempt-specific updates.',
    sourceRef: 'Paper 3B · Module 2 · Chapter 8: Input Tax Credit', applicableAttempt: 'May 2026 onwards · verify statutory updates',
  },
  {
    id: 'case-g1-destination', subject: 'Taxation', kind: 'case-study',
    caseStudy: {
      title: 'Case: Goods involving movement',
      passage: 'Goods move from a supplier in one State to a customer in another State under a taxable supply. The movement ends when the goods are delivered to that customer.',
    },
    prompt: 'For a supply involving movement of goods, the place of supply is generally the location where the movement:',
    options: ['Terminates for delivery to the recipient', 'Begins only because the invoice is printed', 'Is entered in the auditor’s records', 'Was approved by the supplier’s banker'],
    answer: 0,
    explanation: 'For goods involving movement, the general rule links place of supply to where movement terminates for delivery to the recipient, subject to specific statutory rules.',
    sourceRef: 'Paper 3B · Module 1 · Chapter 4: Place of Supply', applicableAttempt: 'May 2026 onwards · verify statutory updates',
  },
  {
    id: 'case-g2-contribution', subject: 'Costing', kind: 'case-study',
    caseStudy: {
      title: 'Case: Product contribution',
      passage: 'A product sells for ₹100 per unit and has variable cost of ₹60 per unit. Fixed cost for the period is ₹2,00,000.',
    },
    prompt: 'What is contribution per unit?',
    options: ['₹20', '₹40', '₹60', '₹100'],
    answer: 1,
    explanation: 'Contribution per unit = selling price ₹100 − variable cost ₹60 = ₹40.',
    sourceRef: 'Paper 4 · Module 2 · Chapter 14: Marginal Costing', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'case-g2-break-even', subject: 'Costing', kind: 'case-study',
    caseStudy: {
      title: 'Case: Break-even planning',
      passage: 'A product sells for ₹100 per unit, variable cost is ₹60 per unit, and total fixed cost is ₹2,00,000.',
    },
    prompt: 'What is the break-even point in units?',
    options: ['2,000 units', '3,333 units', '5,000 units', '8,000 units'],
    answer: 2,
    explanation: 'Contribution is ₹40 per unit; break-even units = ₹2,00,000 ÷ ₹40 = 5,000 units.',
    sourceRef: 'Paper 4 · Module 2 · Chapter 14: Marginal Costing', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'case-g2-evidence', subject: 'Audit', kind: 'case-study',
    caseStudy: {
      title: 'Case: Conflicting audit evidence',
      passage: 'Management provides an oral explanation for a material receivable, while a reliable external confirmation shows a different balance.',
    },
    prompt: 'Which evidence would ordinarily carry greater reliability for this balance?',
    options: ['The external confirmation', 'The oral explanation automatically', 'Neither can ever be considered', 'The larger numerical amount'],
    answer: 0,
    explanation: 'Evidence from an independent external source is generally more reliable, though the auditor must investigate the inconsistency.',
    sourceRef: 'Paper 5 · Module 1 · Chapter 4: Audit Evidence', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'case-g2-representation', subject: 'Audit', kind: 'case-study',
    caseStudy: {
      title: 'Case: Written representation',
      passage: 'For a material area, the audit team plans to obtain only a written management representation and perform no other available audit procedure.',
    },
    prompt: 'Is a written representation ordinarily a substitute for other necessary audit evidence?',
    options: ['Yes, in every audit area', 'No, it does not replace other necessary evidence', 'Yes, whenever signed in blue ink', 'Only when audit fees are paid'],
    answer: 1,
    explanation: 'Written representations are audit evidence but do not replace other audit evidence that the auditor expects to be available.',
    sourceRef: 'Paper 5 · Module 2 · Chapter 7: Completion and Review', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'case-g2-npv', subject: 'FM', kind: 'case-study',
    caseStudy: {
      title: 'Case: Investment evaluation',
      passage: 'A project requires an immediate outflow of ₹10 lakh. At the required discount rate, the present value of expected future inflows is ₹12 lakh.',
    },
    prompt: 'What is the project’s NPV and the general decision for an independent project?',
    options: ['−₹2 lakh; accept', '+₹2 lakh; generally accept', '+₹22 lakh; reject', 'Zero; always reject'],
    answer: 1,
    explanation: 'NPV = ₹12 lakh − ₹10 lakh = +₹2 lakh; a positive-NPV independent project is generally acceptable, subject to other constraints.',
    sourceRef: 'Paper 6A · Module 2 · Chapter 7: Investment Decisions', applicableAttempt: 'May 2026 onwards',
  },
  {
    id: 'case-g2-swot', subject: 'SM', kind: 'case-study',
    caseStudy: {
      title: 'Case: Strategic diagnosis',
      passage: 'A company has a strong distribution network, but a new regulation may significantly increase compliance cost across the industry.',
    },
    prompt: 'In SWOT terms, the strong network and new regulation are respectively a:',
    options: ['Threat and strength', 'Strength and threat', 'Weakness and opportunity', 'Opportunity and weakness'],
    answer: 1,
    explanation: 'The internal strong distribution network is a strength; an adverse external regulatory change is a threat.',
    sourceRef: 'Paper 6B · Chapter 3: Strategic Analysis: Internal Environment', applicableAttempt: 'May 2026 onwards',
  },
];
