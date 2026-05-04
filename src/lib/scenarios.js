// Three pre-loaded scenarios, one per Guidewire core product.
// These are the buttons under the request input.
// During scenario rehearsal (session 3), refine the agent against these.

export const SCENARIOS = [
  {
    id: 'hybrid-vehicle',
    lob: 'PolicyCenter',
    text: 'We need to add a discount for hybrid and electric vehicles in Personal Auto.',
    label: 'Hybrid Vehicle Discount',
    notes: 'Touches typelists (vehicle fuel type), rating (new factor), forms (disclosure), and underwriting rules. Strongest opener — ambiguities at gate 1 land well in the room.'
  },
  {
    id: 'fnol-glass',
    lob: 'ClaimCenter',
    text: 'Auto-assign low-severity glass claims to the express handling queue.',
    label: 'FNOL Automation Rule',
    notes: 'Workflow rules, claim classification, assignment logic. Good for demonstrating the agent on workflow shape (vs rating shape).'
  },
  {
    id: 'dunning-commercial',
    lob: 'BillingCenter',
    text: 'Change the dunning schedule for direct-bill commercial accounts to add a third notice at 60 days.',
    label: 'Dunning Policy Change',
    notes: 'Configuration change, smaller estimate, faster walkthrough. Useful as closer or as second scenario in a 30-min session.'
  }
];
