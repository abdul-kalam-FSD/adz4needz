import { Link } from 'react-router-dom';
import LeadsListView from '../components/LeadsListView.jsx';

export default function LeadsPage() {
  return (
    <>
      <div className="page-head">
        <h1>My Leads</h1>
        <Link className="btn btn-primary btn-as-link" to="/leads/new">Add lead</Link>
      </div>
      <LeadsListView mode="bde" />
    </>
  );
}
