import { useState } from 'react';
import LeadsListView from '../components/LeadsListView.jsx';
import LeadSheetPanel from '../components/LeadSheetPanel.jsx';

export default function AdminLeadsPage() {
  // Bumping the key re-mounts the list so it shows the new values after a sheet was applied.
  const [version, setVersion] = useState(0);
  return (
    <>
      <h1>All Leads</h1>
      <p className="hint">Leads of the whole team. The responsible BDE is shown for every lead. Status, follow-up date and next action can be updated in bulk with Excel.</p>
      <LeadSheetPanel onApplied={() => setVersion((v) => v + 1)} />
      <LeadsListView key={version} mode="admin" />
    </>
  );
}
