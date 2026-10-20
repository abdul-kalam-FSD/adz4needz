import { Link } from 'react-router-dom';
import LeadsListView from '../components/LeadsListView.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function LeadsPage() {
  return (
    <>
      <PageHeader title="Leads" actions={<Link className="btn btn-primary btn-as-link" to="/leads/new">Add lead</Link>} />
      <LeadsListView mode="bde" />
    </>
  );
}
