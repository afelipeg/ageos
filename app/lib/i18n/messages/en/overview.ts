// English messages: overview.
export const overview = {
  title: "Overview",
  description: "{app} · figures from persisted records",
  kpi: {
    activeJobs: "Active jobs",
    activeJobsHelp: "Open or in-progress jobs in the primary reporting group.",
    pendingApprovals: "Pending approvals",
    pendingApprovalsHelp: "Approval requests waiting for an eligible decision.",
    pendingBilling: "Pending billing",
    pendingBillingHelp: "Approved client billable (fee + managed media) of active jobs not yet invoiced. Demo invoices issued: {issued}.",
    projectedMargin: "Projected margin",
    projectedMarginHelp: "Σ(approved fee − forecast cost) ÷ Σ approved fee, active jobs, {currency}. Managed media excluded.",
    open: "Open",
  },
  attention: {
    title: "Needs attention",
    description: "Ordered by risk; each item comes from an explicit rule.",
    empty: "Nothing needs attention right now.",
    job: "Job",
    issue: "Issue",
    effect: "Effect",
    action: "Action",
    marginEffect: "Projected margin {value} (floor {floor})",
  },
  recentJobs: {
    title: "Recent jobs",
    description: "Same query and margin definition as the Jobs desk.",
    empty: "No jobs yet.",
    create: "Create first job",
    viewAll: "View all jobs",
  },
  activity: {
    title: "Recent activity",
    description: "Immutable audit events.",
    empty: "No activity yet.",
  },
  businessDate: "Demo business date {date} · real audit time shown per event",
}
