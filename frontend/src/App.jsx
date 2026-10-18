import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import { RequireAuth, RequireRole } from './auth/RequireAuth.jsx';
import AppShell from './components/AppShell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DailyReportPage from './pages/DailyReportPage.jsx';
import AdminDashboardPage from './pages/AdminDashboardPage.jsx';
import BdeListPage from './pages/BdeListPage.jsx';
import BdeDetailPage from './pages/BdeDetailPage.jsx';
import CallDeskPage from './pages/CallDeskPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import LeadsPage from './pages/LeadsPage.jsx';
import LeadFormPage from './pages/LeadFormPage.jsx';
import AdminLeadsPage from './pages/AdminLeadsPage.jsx';
import InterviewsPage from './pages/InterviewsPage.jsx';
import InterviewFormPage from './pages/InterviewFormPage.jsx';
import AdminInterviewsPage from './pages/AdminInterviewsPage.jsx';
import PaymentsPage from './pages/PaymentsPage.jsx';
import PaymentFormPage from './pages/PaymentFormPage.jsx';
import PaymentDetailPage from './pages/PaymentDetailPage.jsx';
import AdminPaymentsPage from './pages/AdminPaymentsPage.jsx';
import AdminPaymentDetailPage from './pages/AdminPaymentDetailPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import AdminImportPage from './pages/AdminImportPage.jsx';
import AdminReportsPage from './pages/AdminReportsPage.jsx';
import MonthlyReportPage from './pages/MonthlyReportPage.jsx';
import AdminEmployeesPage from './pages/AdminEmployeesPage.jsx';
import BdeDashboardPage from './pages/BdeDashboardPage.jsx';
import AdminAssignPage from './pages/AdminAssignPage.jsx';
import AdminActivityPage from './pages/AdminActivityPage.jsx';

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<HomeRedirect />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="daily-report" element={<RequireRole role="bde"><DailyReportPage /></RequireRole>} />
        <Route path="call-desk" element={<RequireRole role="bde"><CallDeskPage /></RequireRole>} />
        <Route path="leads" element={<RequireRole role="bde"><LeadsPage /></RequireRole>} />
        <Route path="leads/new" element={<RequireRole role="bde"><LeadFormPage /></RequireRole>} />
        <Route path="leads/:id/edit" element={<RequireRole role="bde"><LeadFormPage /></RequireRole>} />
        <Route path="interviews" element={<RequireRole role="bde"><InterviewsPage /></RequireRole>} />
        <Route path="interviews/new" element={<RequireRole role="bde"><InterviewFormPage /></RequireRole>} />
        <Route path="interviews/:id/edit" element={<RequireRole role="bde"><InterviewFormPage /></RequireRole>} />
        <Route path="payments" element={<RequireRole role="bde"><PaymentsPage /></RequireRole>} />
        <Route path="payments/new" element={<RequireRole role="bde"><PaymentFormPage /></RequireRole>} />
        <Route path="payments/:id" element={<RequireRole role="bde"><PaymentDetailPage /></RequireRole>} />
        <Route path="payments/:id/edit" element={<RequireRole role="bde"><PaymentFormPage /></RequireRole>} />
        <Route path="admin/payments" element={<RequireRole role="admin"><AdminPaymentsPage /></RequireRole>} />
        <Route path="admin/payments/:id" element={<RequireRole role="admin"><AdminPaymentDetailPage /></RequireRole>} />
        <Route path="admin/interviews" element={<RequireRole role="admin"><AdminInterviewsPage /></RequireRole>} />
        <Route path="admin/leads" element={<RequireRole role="admin"><AdminLeadsPage /></RequireRole>} />
        <Route path="admin/reports" element={<RequireRole role="admin"><AdminReportsPage /></RequireRole>} />
        <Route path="admin/assign" element={<RequireRole role="admin"><AdminAssignPage /></RequireRole>} />
        <Route path="admin/activity" element={<RequireRole role="admin"><AdminActivityPage /></RequireRole>} />
        <Route path="admin/employees" element={<RequireRole role="admin"><AdminEmployeesPage /></RequireRole>} />
        <Route path="dashboard" element={<RequireRole role="bde"><BdeDashboardPage /></RequireRole>} />
        <Route path="monthly" element={<RequireRole role="bde"><MonthlyReportPage /></RequireRole>} />
        <Route path="admin/import" element={<RequireRole role="admin"><AdminImportPage /></RequireRole>} />
        <Route path="admin" element={<RequireRole role="admin"><AdminDashboardPage /></RequireRole>} />
        <Route path="admin/bdes" element={<RequireRole role="admin"><BdeListPage /></RequireRole>} />
        <Route path="admin/bdes/:id" element={<RequireRole role="admin"><BdeDetailPage /></RequireRole>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
