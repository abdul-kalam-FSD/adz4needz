import { Link } from 'react-router-dom';
import PaymentsListView from '../components/PaymentsListView.jsx';

export default function PaymentsPage() {
  return (
    <>
      <div className="page-head">
        <h1>My Payments</h1>
        <Link className="btn btn-primary btn-as-link" to="/payments/new">Add payment</Link>
      </div>
      <p className="hint">A payment is a commitment for one of your leads. Record each amount you receive as an instalment, then attach the receipt or screenshot.</p>
      <PaymentsListView mode="bde" />
    </>
  );
}
