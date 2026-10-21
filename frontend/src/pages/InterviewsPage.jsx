import { Link } from 'react-router-dom';
import InterviewsListView from '../components/InterviewsListView.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function InterviewsPage() {
  return (
    <>
      <PageHeader
        title="My Interviews"
        description="Interviews for your leads. Use Edit to update attendance and outcome."
        actions={<Link className="btn btn-primary btn-as-link" to="/interviews/new">Schedule interview</Link>}
      />
      <InterviewsListView mode="bde" />
    </>
  );
}
