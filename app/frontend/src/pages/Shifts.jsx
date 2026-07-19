import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import Card from '../components/Card';
import Table from '../components/Table';
import Modal from '../components/Modal';
import Input from '../components/Input';
import Button from '../components/Button';
import { Calendar, RefreshCw, Edit, ShieldAlert } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const Shifts = () => {
  const { isAdmin, isManager } = useAuth();
  const isManagerOrAdmin = isAdmin || isManager;

  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(true);

  // Week selection state (stores Monday's date string, e.g. '2026-06-22')
  const [selectedMonday, setSelectedMonday] = useState('');
  const [weekDays, setWeekDays] = useState([]);
  const [progress, setProgress] = useState(null);
  const { addToast } = useToast();

  // Modals
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isAutoModalOpen, setIsAutoModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  // Form states
  const [manualForm, setManualForm] = useState({
    employee_id: '',
    shift_id: '',
    date: ''
  });
  const [autoForm, setAutoForm] = useState({
    start_date: ''
  });

  useEffect(() => {
    // Default to the current week's Monday
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 is Sunday, 1 is Monday, etc.
    const distanceToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today.setDate(today.getDate() + distanceToMonday));
    const mondayStr = monday.toISOString().split('T')[0];

    setSelectedMonday(mondayStr);
    setAutoForm({ start_date: mondayStr });
  }, []);

  useEffect(() => {
    if (selectedMonday) {
      calculateWeekDays(selectedMonday);
      fetchRosterData(selectedMonday);
    }
  }, [selectedMonday]);

  // Parse YYYY-MM-DD as local time to avoid UTC offset shifting day
  const parseLocalDate = (dateStr) => new Date(dateStr + 'T00:00:00');

  const calculateWeekDays = (mondayStr) => {
    const start = parseLocalDate(mondayStr);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const nextDay = new Date(start);
      nextDay.setDate(start.getDate() + i);
      const y = nextDay.getFullYear();
      const m = String(nextDay.getMonth() + 1).padStart(2, '0');
      const d = String(nextDay.getDate()).padStart(2, '0');
      days.push({
        dateStr: `${y}-${m}-${d}`,
        label: nextDay.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
      });
    }
    setWeekDays(days);
  };

  const fetchRosterData = async (monday) => {
    const mondayStr = monday || selectedMonday;
    setLoading(true);
    try {
      const startDate = parseLocalDate(mondayStr);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      const pad = (n) => String(n).padStart(2, '0');
      const endStr = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}`;

      const [empRes, shiftRes, allocRes] = await Promise.all([
        client.get('/api/employees'),
        client.get('/api/shifts'),
        client.get(`/api/shifts/allocations?start_date=${mondayStr}&end_date=${endStr}`)
      ]);

      setEmployees(empRes.data.filter(e => e.status === 'active'));
      setShifts(shiftRes.data);
      setAllocations(allocRes.data);
    } catch (err) {
      console.error('Error fetching roster details:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleWeekChange = (direction) => {
    const current = parseLocalDate(selectedMonday);
    current.setDate(current.getDate() + (direction === 'next' ? 7 : -7));
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    setSelectedMonday(`${y}-${m}-${d}`);
  };

  const getShiftBadge = (empId, dateStr) => {
    const alloc = allocations.find(a => a.employee_id === empId && a.date === dateStr);
    if (!alloc) {
      return <span style={offBadgeStyle}>Off</span>;
    }

    const badgeStyle = {
      backgroundColor: `${alloc.shift_color}15`, // Light opacity background
      color: alloc.shift_color,
      border: `1px solid ${alloc.shift_color}`,
      padding: '0.25rem 0.5rem',
      borderRadius: '6px',
      fontSize: '0.8rem',
      fontWeight: '600',
      display: 'inline-block'
    };

    return <span style={badgeStyle}>{alloc.shift_name}</span>;
  };

  const openManualModal = () => {
    setError('');
    setManualForm({
      employee_id: employees[0]?.id || '',
      shift_id: shifts[0]?.id || '',
      date: selectedMonday
    });
    setIsManualModalOpen(true);
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setActionLoading(true);
    try {
      await client.post('/api/shifts/allocations/manual', manualForm);
      addToast("Shift Assigned", "Manual override allocation saved successfully.", "success");
      setIsManualModalOpen(false);
      fetchRosterData(selectedMonday);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save manual allocation');
      addToast("Assignment Error", err.response?.data?.message || "Failed to save shift override.", "error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAutoSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setActionLoading(true);

    try {
      // Real API call first
      await client.post('/api/shifts/allocations/auto', autoForm);

      // Show progress animation after success
      const steps = [
        { percent: 20, text: "Clearing existing assignments for target week..." },
        { percent: 45, text: "Checking approved employee leave conflicts..." },
        { percent: 70, text: "Running shift rotation algorithm & balancing workloads..." },
        { percent: 90, text: "Validating consecutive-shift constraints..." },
        { percent: 100, text: "Allocation saved successfully!" }
      ];

      for (const step of steps) {
        setProgress(step);
        await new Promise(r => setTimeout(r, 300));
      }

      addToast("Roster Generated", "Shift allocation completed and published for week.", "success");
      setIsAutoModalOpen(false);
      fetchRosterData(selectedMonday);
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to run auto-allocation';
      setError(msg);
      addToast("Roster Error", msg, "error");
    } finally {
      setActionLoading(false);
      setProgress(null);
    }
  };

  if (loading && employees.length === 0) {
    return <div style={loaderStyle}>Loading Shift Roster...</div>;
  }

  return (
    <div className="fade-in">
      <div style={headerStyle}>
        <div>
          <h2>Weekly Shift Roster</h2>
          <p>Review workload and automatic rotation rosters.</p>
        </div>
        
        <div style={navigatorStyle}>
          <Button variant="outline" onClick={() => handleWeekChange('prev')}>&larr; Prev Week</Button>
          <div style={dateIndicatorStyle}>
            <Calendar size={18} />
            <span><strong>Week starting: {selectedMonday}</strong></span>
          </div>
          <Button variant="outline" onClick={() => handleWeekChange('next')}>Next Week &rarr;</Button>
        </div>

        {isManagerOrAdmin && (
          <div style={actionsStyle}>
            <Button variant="outline" onClick={() => setIsAutoModalOpen(true)}>
              <RefreshCw size={16} /> Auto Allocator
            </Button>
            <Button variant="primary" onClick={openManualModal}>
              <Edit size={16} /> Manual Override
            </Button>
          </div>
        )}
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <Table 
            headers={['Employee', ...weekDays.map(d => d.label)]}
            isEmpty={employees.length === 0}
          >
            {employees.map((emp) => (
              <tr key={emp.id}>
                <td style={empColumnStyle}>
                  <strong>{emp.first_name} {emp.last_name}</strong>
                  <span style={empSubtextStyle}>{emp.role_name || 'Staff'}</span>
                </td>
                {weekDays.map((day) => (
                  <td key={day.dateStr} style={{ textAlign: 'center' }}>
                    {getShiftBadge(emp.id, day.dateStr)}
                  </td>
                ))}
              </tr>
            ))}
          </Table>
        </div>
      </Card>

      {/* 1. Manual Override Modal */}
      <Modal isOpen={isManualModalOpen} onClose={() => setIsManualModalOpen(false)} title="Manual Shift Override">
        <form onSubmit={handleManualSubmit}>
          {error && <div style={errorStyle}>{error}</div>}

          <Input
            label="Select Employee"
            id="employee_id"
            name="employee_id"
            type="select"
            value={manualForm.employee_id}
            onChange={(e) => setManualForm({ ...manualForm, employee_id: e.target.value })}
            options={employees.map(e => ({ value: e.id, label: `${e.first_name} ${e.last_name} (${e.id})` }))}
            required
          />

          <Input
            label="Select Shift"
            id="shift_id"
            name="shift_id"
            type="select"
            value={manualForm.shift_id}
            onChange={(e) => setManualForm({ ...manualForm, shift_id: e.target.value })}
            options={shifts.map(s => ({ value: s.id, label: `${s.name} (${s.start_time} - ${s.end_time})` }))}
            required
          />

          <Input
            label="Allocation Date"
            id="date"
            name="date"
            type="date"
            value={manualForm.date}
            onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })}
            required
          />

          <div style={modalFooterStyle}>
            <Button variant="outline" onClick={() => setIsManualModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={actionLoading}>Save Assignment</Button>
          </div>
        </form>
      </Modal>

      {/* 2. Auto-Scheduler Modal */}
      <Modal isOpen={isAutoModalOpen} onClose={() => setIsAutoModalOpen(false)} title="Automatic Weekly Shift Allocation">
        {progress ? (
          <div style={{ padding: '2rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <RefreshCw size={36} color="var(--primary-color)" style={{ animation: 'spin 1.5s linear infinite', marginBottom: '1rem' }} />
            <div className="progress-bar-container" style={{ margin: '1rem 0' }}>
              <div className="progress-bar-fill" style={{ width: `${progress.percent}%` }}></div>
            </div>
            <div className="progress-step-text" style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{progress.text}</div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Do not close this modal while generation is in progress.</p>
          </div>
        ) : (
          <form onSubmit={handleAutoSubmit}>
            {error && <div style={errorStyle}>{error}</div>}

            <div style={warningAlertStyle}>
              <ShieldAlert size={20} color="var(--warning-dark)" />
              <p style={{ margin: 0, fontSize: '0.85rem' }}>
                <strong>Caution:</strong> Running the auto-allocator will clear all pre-existing shift assignments for the targeted week and regenerate workload distributions.
              </p>
            </div>

            <Input
              label="Target Week Start Date (Must be a Monday)"
              id="start_date"
              name="start_date"
              type="date"
              value={autoForm.start_date}
              onChange={(e) => setAutoForm({ ...autoForm, start_date: e.target.value })}
              required
            />

            <div style={modalFooterStyle}>
              <Button variant="outline" onClick={() => setIsAutoModalOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={actionLoading}>Generate Weekly Roster</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};

const loaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '60vh',
  fontSize: '1.25rem',
  color: 'var(--text-secondary)',
  fontWeight: '500',
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '1rem',
  marginBottom: '2rem',
};

const navigatorStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
  backgroundColor: 'var(--card-bg)',
  border: '1px solid var(--border-color)',
  padding: '0.35rem 0.5rem',
  borderRadius: '8px',
};

const dateIndicatorStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  fontSize: '0.9rem',
  color: 'var(--text-secondary)',
};

const actionsStyle = {
  display: 'flex',
  gap: '0.75rem',
};

const empColumnStyle = {
  display: 'flex',
  flexDirection: 'column',
};

const empSubtextStyle = {
  fontSize: '0.75rem',
  color: 'var(--text-muted)',
  marginTop: '0.15rem',
};

const offBadgeStyle = {
  backgroundColor: '#f1f5f9',
  color: 'var(--text-muted)',
  padding: '0.25rem 0.5rem',
  borderRadius: '6px',
  fontSize: '0.8rem',
  fontWeight: '500',
  display: 'inline-block'
};

const modalFooterStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.75rem',
  marginTop: '1.5rem',
};

const errorStyle = {
  backgroundColor: 'var(--danger-light)',
  color: 'var(--danger-dark)',
  padding: '0.75rem 1rem',
  borderRadius: '8px',
  marginBottom: '1rem',
  fontSize: '0.875rem',
  fontWeight: '500',
};

const warningAlertStyle = {
  display: 'flex',
  gap: '0.75rem',
  backgroundColor: 'var(--warning-light)',
  border: '1px solid rgba(245, 158, 11, 0.2)',
  color: 'var(--warning-dark)',
  padding: '0.85rem 1rem',
  borderRadius: '8px',
  marginBottom: '1.25rem',
};

export default Shifts;
