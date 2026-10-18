import { Link } from 'react-router-dom';
import InterviewsListView from '../components/InterviewsListView.jsx';

export default function InterviewsPage() {
  return (
    <>
      <div className="page-head">
        <h1>My Interviews</h1>
        <Link className="btn btn-primary btn-as-link" to="/interviews/new">Schedule interview</Link>
      </div>
      <InterviewsListView mode="bde" />
    </>
  );
}
