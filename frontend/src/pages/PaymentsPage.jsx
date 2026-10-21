import { Link } from 'react-router-dom';
import PaymentsListView from '../components/PaymentsListView.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function PaymentsPage() {
  return (
    <>
      <PageHeader
        title="My Payments"
        description="Commitments for your leads. Record each amount received as an instalment and attach its proof."
        actions={<Link className="btn btn-primary btn-as-link" to="/payments/new">Add payment</Link>}
      />
      <PaymentsListView mode="bde" />
    </>
  );
}
