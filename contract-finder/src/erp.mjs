import { db, parseJson, transaction } from './db.mjs';
import { escapeHtml } from './utils.mjs';

const moneyModules = new Set(['quotations', 'proforma-invoices', 'invoices', 'payment-receipts', 'purchase-orders', 'expenses']);
const lineItemModules = new Set(['quotations', 'proforma-invoices', 'invoices', 'purchase-orders']);
const financialRevenueModules = new Set(['quotations', 'proforma-invoices', 'invoices', 'payment-receipts']);
const financialExpenseModules = new Set(['purchase-orders', 'expenses']);

const baseFields = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'status', label: 'Status', type: 'select', options: ['draft', 'open', 'approved', 'in_progress', 'completed', 'paid', 'cancelled'] },
  { key: 'customer_name', label: 'Customer', type: 'text' },
  { key: 'company_name', label: 'Company', type: 'text' },
  { key: 'contact_name', label: 'Contact', type: 'text' },
  { key: 'amount', label: 'Amount', type: 'number' },
  { key: 'currency', label: 'Currency', type: 'text' },
  { key: 'issue_date', label: 'Issue Date', type: 'date' },
  { key: 'due_date', label: 'Due Date', type: 'date' },
  { key: 'assigned_to', label: 'Assigned To', type: 'text' },
  { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'] },
  { key: 'notes', label: 'Notes', type: 'textarea' }
];

const moduleDefinitions = {
  crm: {
    label: 'CRM',
    group: 'ERP',
    prefix: 'CRM',
    summary: 'Customers, contacts, sites, follow-ups, notes, documents, site visits and history.',
    fields: [
      { key: 'title', label: 'Lead / Account Name', type: 'text', required: true },
      { key: 'status', label: 'Pipeline Status', type: 'select', options: ['new', 'contacted', 'site_visit', 'quoted', 'won', 'lost'] },
      { key: 'customer_name', label: 'Customer', type: 'text', required: true },
      { key: 'company_name', label: 'Company', type: 'text' },
      { key: 'contact_name', label: 'Primary Contact', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'sites', label: 'Sites', type: 'textarea' },
      { key: 'contacts', label: 'Additional Contacts', type: 'textarea' },
      { key: 'follow_up_date', label: 'Next Follow-up', type: 'date' },
      { key: 'site_visit_date', label: 'Site Visit Date', type: 'date' },
      { key: 'history', label: 'Customer History', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  customers: {
    label: 'Customers',
    group: 'ERP',
    prefix: 'CUS',
    summary: 'Customer master data with contacts, sites, GST and service history.',
    fields: [
      { key: 'title', label: 'Customer Name', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'prospect', 'blocked'] },
      { key: 'customer_name', label: 'Display Name', type: 'text', required: true },
      { key: 'company_name', label: 'Company', type: 'text' },
      { key: 'contact_name', label: 'Primary Contact', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'gstin', label: 'GSTIN', type: 'text' },
      { key: 'billing_address', label: 'Billing Address', type: 'textarea' },
      { key: 'sites', label: 'Sites', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  companies: {
    label: 'Companies',
    group: 'ERP',
    prefix: 'CMP',
    summary: 'Company accounts, vendor registrations and corporate customer data.',
    fields: [
      { key: 'title', label: 'Company Name', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'prospect', 'vendor_registered', 'inactive'] },
      { key: 'company_name', label: 'Company', type: 'text', required: true },
      { key: 'industry', label: 'Industry', type: 'text' },
      { key: 'contact_name', label: 'Contact Person', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'website', label: 'Website', type: 'url' },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  quotations: {
    label: 'Quotations',
    group: 'ERP',
    prefix: 'QTN',
    summary: 'GST quotation numbering, line items, PDF/Word export, email and conversion.',
    lineItems: true,
    fields: [
      { key: 'title', label: 'Quotation Title', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['draft', 'sent', 'accepted', 'rejected', 'converted'] },
      { key: 'customer_name', label: 'Customer', type: 'text', required: true },
      { key: 'company_name', label: 'Company', type: 'text' },
      { key: 'contact_name', label: 'Contact', type: 'text' },
      { key: 'issue_date', label: 'Quotation Date', type: 'date' },
      { key: 'due_date', label: 'Valid Until', type: 'date' },
      { key: 'gst_type', label: 'GST Type', type: 'select', options: ['cgst_sgst', 'igst'] },
      { key: 'scope', label: 'Scope of Work', type: 'textarea' },
      { key: 'terms', label: 'Terms', type: 'textarea' }
    ],
    actions: ['convert-to-work-order', 'convert-to-invoice']
  },
  'proforma-invoices': {
    label: 'Proforma Invoices',
    group: 'ERP',
    prefix: 'PRO',
    summary: 'Proforma invoice numbering, GST line items, PDF and print.',
    lineItems: true,
    fields: [
      { key: 'title', label: 'Proforma Title', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['draft', 'sent', 'accepted', 'cancelled'] },
      { key: 'customer_name', label: 'Customer', type: 'text', required: true },
      { key: 'company_name', label: 'Company', type: 'text' },
      { key: 'issue_date', label: 'Issue Date', type: 'date' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'gst_type', label: 'GST Type', type: 'select', options: ['cgst_sgst', 'igst'] },
      { key: 'terms', label: 'Terms', type: 'textarea' }
    ]
  },
  invoices: {
    label: 'GST Invoices',
    group: 'ERP',
    prefix: 'INV',
    summary: 'Tax invoices with CGST, SGST, IGST, HSN/SAC, QR text, payment status and balance.',
    lineItems: true,
    fields: [
      { key: 'title', label: 'Invoice Title', type: 'text', required: true },
      { key: 'status', label: 'Payment Status', type: 'select', options: ['draft', 'sent', 'part_paid', 'paid', 'overdue', 'cancelled'] },
      { key: 'customer_name', label: 'Customer', type: 'text', required: true },
      { key: 'company_name', label: 'Company', type: 'text' },
      { key: 'issue_date', label: 'Invoice Date', type: 'date' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'gst_type', label: 'GST Type', type: 'select', options: ['cgst_sgst', 'igst'] },
      { key: 'payment_received', label: 'Payment Received', type: 'number' },
      { key: 'qr_code_text', label: 'QR Code Text', type: 'textarea' },
      { key: 'terms', label: 'Terms', type: 'textarea' }
    ]
  },
  'payment-receipts': {
    label: 'Payment Receipts',
    group: 'ERP',
    prefix: 'RCT',
    summary: 'Receipts with payment mode, UTR, cheque/cash/online data and outstanding updates.',
    fields: [
      { key: 'title', label: 'Receipt For', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['received', 'reconciled', 'cancelled'] },
      { key: 'customer_name', label: 'Customer', type: 'text', required: true },
      { key: 'company_name', label: 'Company', type: 'text' },
      { key: 'amount', label: 'Amount Received', type: 'number', required: true },
      { key: 'payment_mode', label: 'Payment Mode', type: 'select', options: ['cash', 'cheque', 'online', 'upi', 'bank_transfer'] },
      { key: 'utr', label: 'UTR / Reference', type: 'text' },
      { key: 'cheque_number', label: 'Cheque Number', type: 'text' },
      { key: 'issue_date', label: 'Receipt Date', type: 'date' },
      { key: 'invoice_reference', label: 'Invoice Reference', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  'work-orders': {
    label: 'Work Orders',
    group: 'ERP',
    prefix: 'WO',
    summary: 'Assignments, supervisors, workers, schedule, photos, completion and signatures.',
    fields: [
      { key: 'title', label: 'Work Order Title', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['draft', 'scheduled', 'in_progress', 'completed', 'closed'] },
      { key: 'customer_name', label: 'Customer', type: 'text', required: true },
      { key: 'site', label: 'Site', type: 'text' },
      { key: 'supervisor', label: 'Supervisor', type: 'text' },
      { key: 'workers', label: 'Workers', type: 'textarea' },
      { key: 'issue_date', label: 'Start Date', type: 'date' },
      { key: 'due_date', label: 'End Date', type: 'date' },
      { key: 'scope', label: 'Scope', type: 'textarea' },
      { key: 'completion_note', label: 'Completion Note', type: 'textarea' },
      { key: 'customer_signature', label: 'Customer Signature Name', type: 'text' }
    ]
  },
  'job-cards': {
    label: 'Job Cards',
    group: 'ERP',
    prefix: 'JC',
    summary: 'Technician assignment, check-in/out, before/after photos and safety checklists.',
    fields: [
      { key: 'title', label: 'Job Card Title', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['assigned', 'checked_in', 'checked_out', 'completed', 'approved'] },
      { key: 'customer_name', label: 'Customer', type: 'text' },
      { key: 'technician', label: 'Technician', type: 'text', required: true },
      { key: 'check_in', label: 'Check-in', type: 'datetime-local' },
      { key: 'check_out', label: 'Check-out', type: 'datetime-local' },
      { key: 'safety_checklist', label: 'Safety Checklist', type: 'textarea' },
      { key: 'rope_access_checklist', label: 'Rope Access Checklist', type: 'textarea' },
      { key: 'before_photos', label: 'Before Photo Notes', type: 'textarea' },
      { key: 'after_photos', label: 'After Photo Notes', type: 'textarea' }
    ]
  },
  amc: {
    label: 'AMC Management',
    group: 'ERP',
    prefix: 'AMC',
    summary: 'Annual maintenance contracts with renewal reminders, visits, work orders and invoices.',
    fields: [
      { key: 'title', label: 'AMC Contract', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'renewal_due', 'expired', 'cancelled'] },
      { key: 'customer_name', label: 'Customer', type: 'text', required: true },
      { key: 'company_name', label: 'Company', type: 'text' },
      { key: 'amount', label: 'AMC Value', type: 'number' },
      { key: 'issue_date', label: 'Start Date', type: 'date' },
      { key: 'due_date', label: 'Renewal Date', type: 'date' },
      { key: 'visit_schedule', label: 'Visit Schedule', type: 'textarea' },
      { key: 'scope', label: 'Scope', type: 'textarea' }
    ],
    actions: ['create-work-order', 'create-invoice']
  },
  'purchase-orders': {
    label: 'Purchase Orders',
    group: 'ERP',
    prefix: 'PO',
    summary: 'Vendor approvals, materials, GST and delivery tracking.',
    lineItems: true,
    fields: [
      { key: 'title', label: 'Purchase Order', type: 'text', required: true },
      { key: 'status', label: 'Approval Status', type: 'select', options: ['draft', 'pending_approval', 'approved', 'ordered', 'received', 'cancelled'] },
      { key: 'company_name', label: 'Vendor', type: 'text', required: true },
      { key: 'contact_name', label: 'Vendor Contact', type: 'text' },
      { key: 'issue_date', label: 'PO Date', type: 'date' },
      { key: 'due_date', label: 'Delivery Date', type: 'date' },
      { key: 'delivery_status', label: 'Delivery Status', type: 'select', options: ['pending', 'partial', 'delivered', 'delayed'] },
      { key: 'approval_note', label: 'Approval Note', type: 'textarea' }
    ]
  },
  vendors: {
    label: 'Vendors',
    group: 'ERP',
    prefix: 'VEN',
    summary: 'Vendor master list with GST, contacts, materials and history.',
    fields: [
      { key: 'title', label: 'Vendor Name', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'preferred', 'blocked'] },
      { key: 'company_name', label: 'Company', type: 'text', required: true },
      { key: 'contact_name', label: 'Contact', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'gstin', label: 'GSTIN', type: 'text' },
      { key: 'materials', label: 'Materials / Services', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  inventory: {
    label: 'Inventory',
    group: 'ERP',
    prefix: 'INVY',
    summary: 'Rope access equipment, tools, materials, inspections, expiry and QR labels.',
    fields: [
      { key: 'title', label: 'Item Name', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['available', 'assigned', 'inspection_due', 'expired', 'retired'] },
      { key: 'category', label: 'Category', type: 'select', options: ['rope_access_equipment', 'tools', 'materials', 'ppe', 'vehicle', 'other'] },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'serial_number', label: 'Serial Number', type: 'text' },
      { key: 'inspection_date', label: 'Inspection Date', type: 'date' },
      { key: 'due_date', label: 'Expiry / Next Inspection', type: 'date' },
      { key: 'assigned_to', label: 'Assigned To', type: 'text' },
      { key: 'qr_label', label: 'QR Label', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  expenses: {
    label: 'Expenses',
    group: 'ERP',
    prefix: 'EXP',
    summary: 'Expense categories, receipt attachments and financial reports.',
    fields: [
      { key: 'title', label: 'Expense Title', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['draft', 'submitted', 'approved', 'paid', 'rejected'] },
      { key: 'category', label: 'Category', type: 'select', options: ['travel', 'materials', 'tools', 'salary', 'rent', 'utilities', 'other'] },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'tax_amount', label: 'GST / Tax', type: 'number' },
      { key: 'issue_date', label: 'Expense Date', type: 'date' },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'receipt_reference', label: 'Receipt Reference', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  reports: {
    label: 'Reports',
    group: 'ERP',
    prefix: 'RPT',
    summary: 'Sales, GST, customers, vendors, inventory, AMC, leads, contracts and financial reports.',
    fields: [
      { key: 'title', label: 'Report Name', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['draft', 'generated', 'reviewed', 'archived'] },
      { key: 'report_type', label: 'Report Type', type: 'select', options: ['sales', 'gst', 'customers', 'vendors', 'inventory', 'amc', 'leads', 'contracts', 'financial'] },
      { key: 'issue_date', label: 'From Date', type: 'date' },
      { key: 'due_date', label: 'To Date', type: 'date' },
      { key: 'filters', label: 'Filters', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  documents: {
    label: 'Documents',
    group: 'ERP',
    prefix: 'DOC',
    summary: 'Quotations, contracts, invoices, certificates, insurance and drawings.',
    fields: [
      { key: 'title', label: 'Document Title', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'expired', 'archived', 'pending_review'] },
      { key: 'document_type', label: 'Document Type', type: 'select', options: ['quotation', 'contract', 'invoice', 'certificate', 'insurance', 'drawing', 'other'] },
      { key: 'company_name', label: 'Related Company', type: 'text' },
      { key: 'issue_date', label: 'Issue Date', type: 'date' },
      { key: 'due_date', label: 'Expiry Date', type: 'date' },
      { key: 'file_name', label: 'File Name', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  'company-profile': {
    label: 'Company Profile',
    group: 'ERP',
    prefix: 'CP',
    summary: 'Logo, GSTIN, CIN, PAN, UDYAM, address, bank, UPI, signature and seal details.',
    singleton: true,
    fields: [
      { key: 'title', label: 'Profile Name', type: 'text', required: true },
      { key: 'company_name', label: 'Company Name', type: 'text', required: true },
      { key: 'gstin', label: 'GSTIN', type: 'text' },
      { key: 'cin', label: 'CIN', type: 'text' },
      { key: 'pan', label: 'PAN', type: 'text' },
      { key: 'udyam', label: 'UDYAM', type: 'text' },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'bank_details', label: 'Bank Details', type: 'textarea' },
      { key: 'upi', label: 'UPI', type: 'text' },
      { key: 'signature', label: 'Signature', type: 'text' },
      { key: 'seal', label: 'Seal', type: 'text' }
    ]
  },
  users: {
    label: 'Users',
    group: 'Settings',
    prefix: 'USR',
    summary: 'Internal user register for ERP access planning and operations.',
    fields: [
      { key: 'title', label: 'User Name', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'suspended'] },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'role', label: 'Role', type: 'select', options: ['admin', 'manager', 'accounts', 'operations', 'viewer'] },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  'roles-permissions': {
    label: 'Roles & Permissions',
    group: 'Settings',
    prefix: 'ROLE',
    summary: 'Role definitions and module permission matrix.',
    fields: [
      { key: 'title', label: 'Role Name', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
      { key: 'permissions', label: 'Permissions', type: 'textarea', required: true },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  'audit-logs': {
    label: 'Audit Logs',
    group: 'Settings',
    prefix: 'AUD',
    summary: 'ERP audit register for login, logout, export, delete, import and permission events.',
    fields: [
      { key: 'title', label: 'Audit Event', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['recorded', 'reviewed', 'escalated'] },
      { key: 'action', label: 'Action', type: 'text', required: true },
      { key: 'entity', label: 'Entity', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  'email-templates': {
    label: 'Email Templates',
    group: 'Settings',
    prefix: 'EMAIL',
    summary: 'Reusable email templates for quotations, invoices, receipts and follow-ups.',
    fields: [
      { key: 'title', label: 'Template Name', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'draft'] },
      { key: 'subject', label: 'Subject', type: 'text', required: true },
      { key: 'body', label: 'Body', type: 'textarea', required: true },
      { key: 'module', label: 'Module', type: 'text' }
    ]
  },
  'whatsapp-templates': {
    label: 'WhatsApp Templates',
    group: 'Settings',
    prefix: 'WA',
    summary: 'Reusable WhatsApp message templates for operations and accounts.',
    fields: [
      { key: 'title', label: 'Template Name', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'draft'] },
      { key: 'message', label: 'Message', type: 'textarea', required: true },
      { key: 'module', label: 'Module', type: 'text' }
    ]
  },
  settings: {
    label: 'Settings',
    group: 'Settings',
    prefix: 'SET',
    summary: 'ERP preferences, numbering, taxes, notifications and defaults.',
    fields: [
      { key: 'title', label: 'Setting Name', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
      { key: 'setting_key', label: 'Key', type: 'text', required: true },
      { key: 'setting_value', label: 'Value', type: 'textarea', required: true },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  }
};

moduleDefinitions['financial-dashboard'] = {
  label: 'Financial Dashboard',
  group: 'ERP',
  prefix: 'FIN',
  summary: 'Revenue, expenses, profit, outstanding, GST and monthly trends.',
  fields: moduleDefinitions.reports.fields
};

const aliases = {
  'gst-invoices': 'invoices',
  'tax-invoices': 'invoices',
  'amc-management': 'amc',
  'user-management': 'users',
  dashboard: 'dashboard'
};

export function normalizeErpModule(key = '') {
  const value = String(key || '').trim().toLowerCase();
  return aliases[value] || value;
}

export function listErpModules() {
  return Object.entries(moduleDefinitions).map(([key, definition]) => ({
    key,
    label: definition.label,
    group: definition.group,
    summary: definition.summary,
    fields: definition.fields,
    lineItems: Boolean(definition.lineItems),
    actions: definition.actions || []
  }));
}

export function getErpModule(key) {
  const normalized = normalizeErpModule(key);
  const definition = moduleDefinitions[normalized];
  if (!definition) throw Object.assign(new Error('ERP module not found'), { status: 404 });
  return { key: normalized, ...definition };
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value) {
  return String(value ?? '').trim();
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function nextRecordNumber(module) {
  db.prepare('INSERT OR IGNORE INTO erp_counters(module_key, prefix, next_number) VALUES (?, ?, 1)').run(module.key, module.prefix);
  const row = db.prepare('SELECT next_number FROM erp_counters WHERE module_key = ?').get(module.key);
  const next = Number(row?.next_number || 1);
  db.prepare('UPDATE erp_counters SET next_number = ?, updated_at = CURRENT_TIMESTAMP WHERE module_key = ?').run(next + 1, module.key);
  return `SKY-${module.prefix}-${new Date().getFullYear()}-${String(next).padStart(4, '0')}`;
}

function extractTags(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return clean(value).split(',').map(clean).filter(Boolean);
}

function extractLineItems(input, module) {
  if (!module.lineItems) return [];
  const source = Array.isArray(input.line_items) ? input.line_items : [];
  return source
    .map((item, index) => {
      const quantity = numberValue(item.quantity || 1) || 1;
      const unitPrice = numberValue(item.unit_price);
      const gstRate = numberValue(item.gst_rate);
      const base = quantity * unitPrice;
      const tax = base * gstRate / 100;
      const igstMode = input.gst_type === 'igst' || item.gst_type === 'igst';
      return {
        description: clean(item.description),
        hsn_sac: clean(item.hsn_sac),
        quantity,
        unit: clean(item.unit || 'nos') || 'nos',
        unit_price: unitPrice,
        gst_rate: gstRate,
        cgst: igstMode ? 0 : tax / 2,
        sgst: igstMode ? 0 : tax / 2,
        igst: igstMode ? tax : 0,
        total: base + tax,
        sort_order: index
      };
    })
    .filter((item) => item.description);
}

function calculateTotals(input, module, lineItems) {
  if (lineItems.length) {
    const amount = lineItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    const tax = lineItems.reduce((sum, item) => sum + item.cgst + item.sgst + item.igst, 0);
    return { amount, tax_amount: tax, total_amount: amount + tax };
  }
  const amount = numberValue(input.amount);
  const taxAmount = numberValue(input.tax_amount);
  const total = moneyModules.has(module.key) ? amount + taxAmount : amount;
  return { amount, tax_amount: taxAmount, total_amount: total };
}

function validateInput(input, module) {
  for (const field of module.fields.filter((item) => item.required)) {
    if (!clean(input[field.key])) throw Object.assign(new Error(`${field.label} is required`), { status: 400 });
  }
}

function recordData(input, module) {
  const reserved = new Set(['id', 'module_key', 'record_number', 'title', 'status', 'customer_name', 'company_name', 'contact_name', 'amount', 'tax_amount', 'total_amount', 'currency', 'issue_date', 'due_date', 'assigned_to', 'priority', 'tags', 'line_items']);
  const data = {};
  for (const field of module.fields) {
    if (!reserved.has(field.key)) data[field.key] = input[field.key] ?? '';
  }
  data.module_summary = module.summary;
  data.features = moduleFeatureList(module.key);
  return data;
}

function serializeLineItem(row) {
  return {
    id: row.id,
    description: row.description,
    hsn_sac: row.hsn_sac || '',
    quantity: Number(row.quantity || 0),
    unit: row.unit || 'nos',
    unit_price: Number(row.unit_price || 0),
    gst_rate: Number(row.gst_rate || 0),
    cgst: Number(row.cgst || 0),
    sgst: Number(row.sgst || 0),
    igst: Number(row.igst || 0),
    total: Number(row.total || 0)
  };
}

function serializeRecord(row, includeChildren = false) {
  if (!row) return null;
  const data = parseJson(row.data_json, {});
  const record = {
    ...row,
    amount: Number(row.amount || 0),
    tax_amount: Number(row.tax_amount || 0),
    total_amount: Number(row.total_amount || 0),
    tags: parseJson(row.tags_json, []),
    data
  };
  if (includeChildren) {
    record.line_items = db.prepare('SELECT * FROM erp_line_items WHERE record_id = ? ORDER BY sort_order, id').all(row.id).map(serializeLineItem);
    record.documents = db.prepare('SELECT id, module_key, document_type, filename, content_type, size_bytes, notes, created_at FROM erp_documents WHERE record_id = ? ORDER BY created_at DESC').all(row.id);
    record.activity = db.prepare('SELECT * FROM erp_activity WHERE record_id = ? ORDER BY created_at DESC LIMIT 50').all(row.id).map((item) => ({ ...item, metadata: parseJson(item.metadata_json, {}) }));
  }
  return record;
}

function insertLineItems(recordId, items) {
  const stmt = db.prepare(`INSERT INTO erp_line_items(record_id, description, hsn_sac, quantity, unit, unit_price, gst_rate, cgst, sgst, igst, total, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const item of items) {
    stmt.run(recordId, item.description, item.hsn_sac || null, item.quantity, item.unit, item.unit_price, item.gst_rate, item.cgst, item.sgst, item.igst, item.total, item.sort_order);
  }
}

function insertUploadedDocument(recordId, moduleKey, upload, input, user = null) {
  if (!upload?.body_base64 || !upload?.filename) return;
  db.prepare(`INSERT INTO erp_documents(record_id, module_key, document_type, filename, content_type, size_bytes, body_base64, notes, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(recordId, moduleKey, clean(input.document_type || 'ERP Document'), clean(upload.filename), clean(upload.content_type || 'application/octet-stream'),
      Number(upload.size_bytes || 0), upload.body_base64, clean(input.notes), user?.id || null);
}

function addActivity(moduleKey, recordId, action, user, metadata = {}, note = null) {
  db.prepare(`INSERT INTO erp_activity(module_key, record_id, action, note, metadata_json, user_id)
    VALUES (?, ?, ?, ?, ?, ?)`).run(moduleKey, recordId, action, note, JSON.stringify(metadata), user?.id || null);
}

export function createErpRecord(moduleKey, input, user = null) {
  const module = getErpModule(moduleKey);
  validateInput(input, module);
  const lineItems = extractLineItems(input, module);
  const totals = calculateTotals(input, module, lineItems);
  return transaction(() => {
    const recordNumber = input.record_number || nextRecordNumber(module);
    const result = db.prepare(`INSERT INTO erp_records(module_key, record_number, title, status, customer_name, company_name, contact_name,
      amount, tax_amount, total_amount, currency, issue_date, due_date, assigned_to, priority, tags_json, data_json, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(module.key, recordNumber, clean(input.title), clean(input.status || module.fields.find((field) => field.key === 'status')?.options?.[0] || 'draft'),
        clean(input.customer_name), clean(input.company_name), clean(input.contact_name), totals.amount, totals.tax_amount, totals.total_amount,
        clean(input.currency || 'INR') || 'INR', clean(input.issue_date || currentDate()), clean(input.due_date), clean(input.assigned_to),
        clean(input.priority || 'normal') || 'normal', JSON.stringify(extractTags(input.tags)), JSON.stringify(recordData(input, module)), user?.id || null, user?.id || null);
    const id = Number(result.lastInsertRowid);
    insertLineItems(id, lineItems);
    insertUploadedDocument(id, module.key, input.file_upload, input, user);
    addActivity(module.key, id, 'create', user, { record_number: recordNumber });
    return getErpRecord(module.key, id);
  });
}

export function updateErpRecord(moduleKey, id, input, user = null) {
  const module = getErpModule(moduleKey);
  const existing = db.prepare('SELECT * FROM erp_records WHERE module_key = ? AND id = ?').get(module.key, id);
  if (!existing) throw Object.assign(new Error('ERP record not found'), { status: 404 });
  const merged = { ...parseJson(existing.data_json, {}), ...existing, ...input };
  validateInput(merged, module);
  const lineItems = Array.isArray(input.line_items) ? extractLineItems(input, module) : null;
  const totals = calculateTotals(merged, module, lineItems || db.prepare('SELECT * FROM erp_line_items WHERE record_id = ?').all(id).map(serializeLineItem));
  return transaction(() => {
    db.prepare(`UPDATE erp_records SET title = ?, status = ?, customer_name = ?, company_name = ?, contact_name = ?,
      amount = ?, tax_amount = ?, total_amount = ?, currency = ?, issue_date = ?, due_date = ?, assigned_to = ?,
      priority = ?, tags_json = ?, data_json = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND module_key = ?`)
      .run(clean(merged.title), clean(merged.status || existing.status), clean(merged.customer_name), clean(merged.company_name), clean(merged.contact_name),
        totals.amount, totals.tax_amount, totals.total_amount, clean(merged.currency || 'INR') || 'INR', clean(merged.issue_date), clean(merged.due_date),
        clean(merged.assigned_to), clean(merged.priority || 'normal') || 'normal', JSON.stringify(extractTags(merged.tags)), JSON.stringify(recordData(merged, module)),
        user?.id || null, id, module.key);
    if (lineItems) {
      db.prepare('DELETE FROM erp_line_items WHERE record_id = ?').run(id);
      insertLineItems(id, lineItems);
    }
    insertUploadedDocument(id, module.key, input.file_upload, merged, user);
    addActivity(module.key, id, 'update', user, { changed_fields: Object.keys(input) });
    return getErpRecord(module.key, id);
  });
}

export function deleteErpRecord(moduleKey, id, user = null) {
  const module = getErpModule(moduleKey);
  const existing = db.prepare('SELECT id FROM erp_records WHERE module_key = ? AND id = ?').get(module.key, id);
  if (!existing) throw Object.assign(new Error('ERP record not found'), { status: 404 });
  db.prepare('DELETE FROM erp_records WHERE module_key = ? AND id = ?').run(module.key, id);
  addActivity(module.key, null, 'delete', user, { deleted_id: id });
  return { ok: true };
}

export function getErpRecord(moduleKey, id) {
  const module = getErpModule(moduleKey);
  const row = db.prepare('SELECT * FROM erp_records WHERE module_key = ? AND id = ?').get(module.key, id);
  if (!row) throw Object.assign(new Error('ERP record not found'), { status: 404 });
  return serializeRecord(row, true);
}

const sortMap = {
  newest: 'created_at DESC',
  oldest: 'created_at ASC',
  title: 'title COLLATE NOCASE ASC',
  'title:desc': 'title COLLATE NOCASE DESC',
  status: 'status COLLATE NOCASE ASC',
  amount: 'total_amount ASC',
  'amount:desc': 'total_amount DESC',
  due: 'due_date ASC',
  'due:desc': 'due_date DESC'
};

export function listErpRecords(moduleKey, filters = {}) {
  const module = getErpModule(moduleKey);
  const page = Math.max(1, Number.parseInt(filters.page || '1', 10) || 1);
  const pageSize = Math.min(200, Math.max(10, Number.parseInt(filters.page_size || '25', 10) || 25));
  const clauses = ['module_key = ?'];
  const values = [module.key];
  if (clean(filters.keyword)) {
    clauses.push('(title LIKE ? OR record_number LIKE ? OR customer_name LIKE ? OR company_name LIKE ? OR contact_name LIKE ? OR data_json LIKE ?)');
    const keyword = `%${clean(filters.keyword)}%`;
    values.push(keyword, keyword, keyword, keyword, keyword, keyword);
  }
  for (const key of ['status', 'customer_name', 'company_name', 'priority']) {
    if (clean(filters[key])) { clauses.push(`${key} = ?`); values.push(clean(filters[key])); }
  }
  if (clean(filters.date_from)) { clauses.push('COALESCE(issue_date, created_at) >= ?'); values.push(clean(filters.date_from)); }
  if (clean(filters.date_to)) { clauses.push('COALESCE(issue_date, created_at) <= ?'); values.push(clean(filters.date_to)); }
  const where = clauses.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS count FROM erp_records WHERE ${where}`).get(...values).count;
  const sort = sortMap[filters.sort] || sortMap.newest;
  const items = db.prepare(`SELECT * FROM erp_records WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`)
    .all(...values, pageSize, (page - 1) * pageSize).map((row) => serializeRecord(row));
  const statuses = db.prepare('SELECT DISTINCT status FROM erp_records WHERE module_key = ? ORDER BY status').all(module.key).map((row) => row.status);
  return { module, items, filters: { statuses }, pagination: { page, page_size: pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) } };
}

export function erpDashboard() {
  const countByModule = db.prepare('SELECT module_key, COUNT(*) AS count FROM erp_records GROUP BY module_key').all();
  const revenue = db.prepare(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM erp_records WHERE module_key IN (${[...financialRevenueModules].map(() => '?').join(',')})`).get(...financialRevenueModules).total;
  const expenses = db.prepare(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM erp_records WHERE module_key IN (${[...financialExpenseModules].map(() => '?').join(',')})`).get(...financialExpenseModules).total;
  const outstanding = db.prepare("SELECT COALESCE(SUM(total_amount - COALESCE(json_extract(data_json, '$.payment_received'), 0)), 0) AS total FROM erp_records WHERE module_key = 'invoices' AND status <> 'paid'").get().total;
  const gst = db.prepare("SELECT COALESCE(SUM(tax_amount), 0) AS total FROM erp_records WHERE module_key IN ('quotations','proforma-invoices','invoices','purchase-orders')").get().total;
  const trends = db.prepare(`SELECT substr(COALESCE(issue_date, created_at), 1, 7) AS month,
      SUM(CASE WHEN module_key IN ('invoices','payment-receipts') THEN total_amount ELSE 0 END) AS revenue,
      SUM(CASE WHEN module_key IN ('purchase-orders','expenses') THEN total_amount ELSE 0 END) AS expenses
    FROM erp_records GROUP BY month ORDER BY month DESC LIMIT 12`).all();
  const due = db.prepare("SELECT * FROM erp_records WHERE due_date IS NOT NULL AND due_date <= date('now', '+30 days') ORDER BY due_date ASC LIMIT 12").all().map((row) => serializeRecord(row));
  return {
    total_records: countByModule.reduce((sum, row) => sum + row.count, 0),
    modules: Object.fromEntries(countByModule.map((row) => [row.module_key, row.count])),
    revenue: Number(revenue || 0),
    expenses: Number(expenses || 0),
    profit: Number(revenue || 0) - Number(expenses || 0),
    outstanding: Number(outstanding || 0),
    gst: Number(gst || 0),
    trends,
    due
  };
}

function exportRows(moduleKey, filters = {}) {
  return listErpRecords(moduleKey, { ...filters, page: 1, page_size: 200 }).items;
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function exportErpCsv(moduleKey, filters = {}) {
  const rows = exportRows(moduleKey, filters);
  const headers = ['record_number', 'title', 'status', 'customer_name', 'company_name', 'amount', 'tax_amount', 'total_amount', 'currency', 'issue_date', 'due_date'];
  return [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n');
}

export function exportErpExcel(moduleKey, filters = {}) {
  const rows = exportRows(moduleKey, filters);
  const headers = ['Record #', 'Title', 'Status', 'Customer', 'Company', 'Amount', 'Tax', 'Total', 'Currency', 'Issue Date', 'Due Date'];
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>
    <td>${escapeHtml(row.record_number)}</td><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.status)}</td>
    <td>${escapeHtml(row.customer_name)}</td><td>${escapeHtml(row.company_name)}</td><td>${row.amount}</td><td>${row.tax_amount}</td><td>${row.total_amount}</td>
    <td>${escapeHtml(row.currency)}</td><td>${escapeHtml(row.issue_date)}</td><td>${escapeHtml(row.due_date)}</td>
  </tr>`).join('')}</tbody></table>`;
}

export function printableErpHtml(moduleKey, id) {
  const module = getErpModule(moduleKey);
  const record = getErpRecord(module.key, id);
  const company = companyProfile();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(record.record_number)}</title>
    <style>body{font-family:Arial,sans-serif;color:#111;margin:32px}.header{display:flex;justify-content:space-between;border-bottom:2px solid #f59e0b;padding-bottom:16px}.muted{color:#555}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ccc;padding:8px;text-align:left}.total{text-align:right;font-size:18px;margin-top:20px}.box{border:1px solid #ddd;padding:12px;margin-top:16px}</style></head>
    <body><div class="header"><div><h1>${escapeHtml(company.company_name || 'Skyproz Services')}</h1><p class="muted">${escapeHtml(company.address || 'Kerala, India')}</p><p>GSTIN: ${escapeHtml(company.gstin || '32BWTPV0466R1ZH')}</p></div><div><h2>${escapeHtml(module.label)}</h2><p>${escapeHtml(record.record_number)}</p><p>${escapeHtml(record.issue_date || '')}</p></div></div>
    <div class="box"><strong>${escapeHtml(record.customer_name || record.company_name || 'Internal')}</strong><p>${escapeHtml(record.contact_name || '')}</p><p>${escapeHtml(record.data?.scope || record.data?.notes || '')}</p></div>
    ${record.line_items.length ? `<table><thead><tr><th>Description</th><th>HSN/SAC</th><th>Qty</th><th>Rate</th><th>GST</th><th>Total</th></tr></thead><tbody>${record.line_items.map((item) => `<tr><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.hsn_sac)}</td><td>${item.quantity}</td><td>${item.unit_price}</td><td>${item.gst_rate}%</td><td>${item.total.toFixed(2)}</td></tr>`).join('')}</tbody></table>` : ''}
    <p class="total">Subtotal: ${record.currency} ${record.amount.toFixed(2)}<br>GST: ${record.currency} ${record.tax_amount.toFixed(2)}<br><strong>Total: ${record.currency} ${record.total_amount.toFixed(2)}</strong></p>
    <div class="box"><strong>Status:</strong> ${escapeHtml(record.status)}<br><strong>Due:</strong> ${escapeHtml(record.due_date || 'Not set')}</div>
    <script>window.print()</script></body></html>`;
}

function pdfEscape(value) {
  return String(value ?? '').replace(/[^\x20-\x7E]/g, ' ').replace(/[()\\]/g, '\\$&');
}

export function erpPdf(moduleKey, id) {
  const module = getErpModule(moduleKey);
  const record = getErpRecord(module.key, id);
  const lines = [
    'Skyproz Services',
    `${module.label}: ${record.record_number}`,
    record.title,
    `Customer: ${record.customer_name || record.company_name || 'Internal'}`,
    `Status: ${record.status}`,
    `Amount: ${record.currency} ${record.amount.toFixed(2)}`,
    `GST: ${record.currency} ${record.tax_amount.toFixed(2)}`,
    `Total: ${record.currency} ${record.total_amount.toFixed(2)}`,
    `Due: ${record.due_date || 'Not set'}`,
    ...record.line_items.slice(0, 12).map((item) => `${item.description} - ${item.quantity} x ${item.unit_price} = ${item.total.toFixed(2)}`)
  ];
  const stream = `BT /F1 12 Tf 50 780 Td ${lines.map((line, index) => `${index ? '0 -18 Td ' : ''}(${pdfEscape(line)}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\n`;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

export function erpWordHtml(moduleKey, id) {
  return printableErpHtml(moduleKey, id).replace('<script>window.print()</script>', '');
}

export function runErpAction(moduleKey, id, action, user = null) {
  const module = getErpModule(moduleKey);
  const record = getErpRecord(module.key, id);
  if (action === 'convert-to-work-order' || action === 'create-work-order') {
    const created = createErpRecord('work-orders', {
      title: `Work Order for ${record.title}`,
      status: 'scheduled',
      customer_name: record.customer_name,
      company_name: record.company_name,
      issue_date: currentDate(),
      due_date: record.due_date,
      scope: record.data?.scope || record.data?.notes || '',
      notes: `Created from ${record.record_number}`
    }, user);
    addActivity(module.key, record.id, action, user, { created_module: 'work-orders', created_id: created.id });
    return { created };
  }
  if (action === 'convert-to-invoice' || action === 'create-invoice') {
    const created = createErpRecord('invoices', {
      title: `Invoice for ${record.title}`,
      status: 'sent',
      customer_name: record.customer_name,
      company_name: record.company_name,
      issue_date: currentDate(),
      due_date: record.due_date,
      gst_type: record.data?.gst_type || 'cgst_sgst',
      line_items: record.line_items.length ? record.line_items : [{ description: record.title, quantity: 1, unit_price: record.total_amount, gst_rate: 0 }]
    }, user);
    addActivity(module.key, record.id, action, user, { created_module: 'invoices', created_id: created.id });
    return { created };
  }
  throw Object.assign(new Error('Unsupported ERP action'), { status: 400 });
}

export function moduleFeatureList(moduleKey) {
  const generic = ['Dashboard', 'List', 'Create', 'Edit', 'View', 'Delete', 'Search', 'Filters', 'Sorting', 'Pagination', 'CSV export', 'Excel export', 'Print', 'PDF'];
  const specific = {
    crm: ['Multiple contacts', 'Multiple sites', 'Follow-ups', 'Notes', 'Documents', 'Site visits', 'Customer history'],
    quotations: ['Auto numbering', 'Line items', 'GST calculation', 'Convert to work order', 'Convert to invoice', 'Word export', 'Email workflow'],
    invoices: ['Tax invoice', 'CGST', 'SGST', 'IGST', 'HSN/SAC', 'QR text', 'Payment status', 'Outstanding balance'],
    'payment-receipts': ['Receipt numbering', 'Cash', 'Cheque', 'Online', 'UTR tracking'],
    'work-orders': ['Assignment', 'Supervisor', 'Workers', 'Schedule', 'Completion', 'Customer signature'],
    'job-cards': ['Check-in', 'Check-out', 'Before photos', 'After photos', 'Safety checklist', 'Rope access checklist'],
    amc: ['Renewal reminders', 'Visit schedules', 'Auto work orders', 'Auto invoices'],
    inventory: ['Rope access equipment', 'Tools', 'Materials', 'Inspections', 'Expiry tracking', 'QR labels'],
    reports: ['Sales', 'GST', 'Customers', 'Vendors', 'Inventory', 'AMC', 'Leads', 'Contracts', 'Financial']
  };
  return [...generic, ...(specific[moduleKey] || [])];
}

export function companyProfile() {
  const row = db.prepare("SELECT * FROM erp_records WHERE module_key = 'company-profile' ORDER BY id LIMIT 1").get();
  if (!row) return {};
  return { ...parseJson(row.data_json, {}), company_name: row.company_name, title: row.title };
}

export function ensureErpSeedData(user = null) {
  for (const module of listErpModules()) {
    db.prepare('INSERT OR IGNORE INTO erp_counters(module_key, prefix, next_number) VALUES (?, ?, 1)').run(module.key, module.prefix || module.key.toUpperCase().slice(0, 4));
  }
  if (!db.prepare("SELECT id FROM erp_records WHERE module_key = 'company-profile' LIMIT 1").get()) {
    createErpRecord('company-profile', {
      title: 'Skyproz Services Profile',
      company_name: 'Skyproz Services',
      gstin: '32BWTPV0466R1ZH',
      pan: 'BWTPV0466R',
      address: 'Kerala, India',
      bank_details: 'Configure bank account details',
      upi: 'info@skyproz.in',
      signature: 'Authorized Signatory',
      seal: 'Skyproz Services'
    }, user);
  }
  const samples = [
    ['customers', { title: 'Metro Mall Facilities', customer_name: 'Metro Mall Facilities', company_name: 'Metro Mall Pvt Ltd', contact_name: 'Facility Manager', status: 'active', phone: '+91 94003 27705', email: 'info@skyproz.in', sites: 'Shopping mall facade and roof access areas' }],
    ['crm', { title: 'High-rise glass cleaning enquiry', customer_name: 'Metro Mall Facilities', company_name: 'Metro Mall Pvt Ltd', contact_name: 'Facility Manager', status: 'site_visit', follow_up_date: currentDate(), sites: 'Main tower, atrium glass, ACP facade', notes: 'Prepare site inspection and quotation.' }],
    ['vendors', { title: 'Industrial Safety Supplier', company_name: 'Industrial Safety Supplier', contact_name: 'Vendor Desk', status: 'preferred', materials: 'Harnesses, helmets, ropes, PPE' }],
    ['inventory', { title: 'Static Rope 11mm - Batch A', status: 'available', category: 'rope_access_equipment', quantity: 12, serial_number: 'RA-ROPE-A', due_date: '2026-12-31', qr_label: 'SKY-ROPE-A' }],
    ['expenses', { title: 'Site inspection travel', status: 'approved', category: 'travel', amount: 2500, tax_amount: 0, issue_date: currentDate(), vendor: 'Operations Team' }],
    ['email-templates', { title: 'Quotation Follow-up', status: 'active', subject: 'Skyproz quotation follow-up', body: 'Dear {{customer}}, please find our quotation {{record_number}} for your review.', module: 'quotations' }],
    ['whatsapp-templates', { title: 'Payment Reminder', status: 'active', message: 'Dear {{customer}}, payment for {{record_number}} is pending. Kindly confirm status.', module: 'invoices' }],
    ['roles-permissions', { title: 'Accounts Manager', status: 'active', permissions: 'quotations:read,write\ninvoices:read,write\nreceipts:read,write\nreports:read' }],
    ['settings', { title: 'Default GST', status: 'active', setting_key: 'default_gst_rate', setting_value: '18' }]
  ];
  for (const [module, input] of samples) {
    if (!db.prepare('SELECT id FROM erp_records WHERE module_key = ? LIMIT 1').get(module)) createErpRecord(module, input, user);
  }
  if (!db.prepare("SELECT id FROM erp_records WHERE module_key = 'quotations' LIMIT 1").get()) {
    createErpRecord('quotations', {
      title: 'Facade cleaning and rope access maintenance',
      status: 'sent',
      customer_name: 'Metro Mall Facilities',
      company_name: 'Metro Mall Pvt Ltd',
      issue_date: currentDate(),
      due_date: '2026-08-15',
      gst_type: 'cgst_sgst',
      scope: 'High-rise glass cleaning, facade inspection and preventive maintenance.',
      line_items: [
        { description: 'Rope access glass cleaning', hsn_sac: '998533', quantity: 1, unit_price: 85000, gst_rate: 18 },
        { description: 'Facade inspection report', hsn_sac: '998346', quantity: 1, unit_price: 25000, gst_rate: 18 }
      ]
    }, user);
  }
}
