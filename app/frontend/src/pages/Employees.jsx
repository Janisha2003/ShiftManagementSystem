import React, { useState, useEffect } from 'react';
import client from '../api/client';
import Card from '../components/Card';
import Table from '../components/Table';
import Modal from '../components/Modal';
import Input from '../components/Input';
import Button from '../components/Button';
import { UserPlus, Edit2, Trash2, FolderPlus, Award } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const Employees = () => {
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();

  // Modals visibility state
  const [isEmpModalOpen, setIsEmpModalOpen] = useState(false);
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);

  // Form states
  const [empForm, setEmpForm] = useState({
    id: '', // Empty for new, filled for edit
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    phone: '',
    department_id: '',
    role_id: '',
    hire_date: new Date().toISOString().split('T')[0],
    status: 'active'
  });

  const [deptForm, setDeptForm] = useState({ name: '', description: '' });
  const [roleForm, setRoleForm] = useState({ name: '', description: '' });
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [empRes, deptRes, roleRes] = await Promise.all([
        client.get('/api/employees'),
        client.get('/api/employees/departments'),
        client.get('/api/employees/roles')
      ]);
      setEmployees(empRes.data);
      setDepartments(deptRes.data);
      setRoles(roleRes.data);
    } catch (err) {
      console.error('Error fetching employee resources:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEmpChange = (e) => {
    setEmpForm({ ...empForm, [e.target.name]: e.target.value });
  };

  const openAddEmpModal = () => {
    setError('');
    setEmpForm({
      id: '',
      first_name: '',
      last_name: '',
      email: '',
      password: '',
      phone: '',
      department_id: departments[0]?.id || '',
      role_id: roles[0]?.id || '',
      hire_date: new Date().toISOString().split('T')[0],
      status: 'active'
    });
    setIsEmpModalOpen(true);
  };

  const openEditEmpModal = (emp) => {
    setError('');
    setEmpForm({
      id: emp.id,
      first_name: emp.first_name,
      last_name: emp.last_name,
      email: emp.email,
      password: '',
      phone: emp.phone || '',
      department_id: emp.department_id || '',
      role_id: emp.role_id || '',
      hire_date: emp.hire_date || '',
      status: emp.status
    });
    setIsEmpModalOpen(true);
  };

  const handleEmpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setActionLoading(true);

    try {
      if (empForm.id) {
        // Edit mode
        const editData = { ...empForm };
        delete editData.password; // Don't update password through simple edit
        await client.put(`/api/employees/${empForm.id}`, editData);
        addToast("Profile Updated", `Details for ${empForm.first_name} ${empForm.last_name} saved.`, "success");
      } else {
        // Create mode
        await client.post('/api/employees', empForm);
        addToast("Employee Created", `Registered ${empForm.first_name} ${empForm.last_name} in database.`, "success");
      }
      setIsEmpModalOpen(false);
      fetchInitialData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save employee profile');
      addToast("Registry Error", err.response?.data?.message || "Failed to save profile.", "error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteEmp = async (empId) => {
    if (!window.confirm(`Are you sure you want to delete employee ${empId}?`)) return;
    try {
      await client.delete(`/api/employees/${empId}`);
      addToast("Employee Removed", `Profile for employee ${empId} has been deleted.`, "success");
      fetchInitialData();
    } catch (err) {
      addToast("Deletion Failed", "Unable to remove employee profile from database.", "error");
    }
  };

  const handleDeptSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setActionLoading(true);
    try {
      await client.post('/api/employees/departments', deptForm);
      addToast("Department Created", `New department '${deptForm.name}' has been defined.`, "success");
      setIsDeptModalOpen(false);
      setDeptForm({ name: '', description: '' });
      fetchInitialData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save department');
      addToast("Department Error", err.response?.data?.message || "Failed to create department.", "error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRoleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setActionLoading(true);
    try {
      await client.post('/api/employees/roles', roleForm);
      addToast("Job Role Created", `New designation '${roleForm.name}' registered.`, "success");
      setIsRoleModalOpen(false);
      setRoleForm({ name: '', description: '' });
      fetchInitialData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save job role');
      addToast("Job Role Error", err.response?.data?.message || "Failed to create role.", "error");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div style={loaderStyle}>Loading Employee Records...</div>;
  }

  return (
    <div className="fade-in">
      <div style={headerStyle}>
        <div>
          <h2>Employee Directory</h2>
          <p>Provision user credentials, assign departments, and manage structural roles.</p>
        </div>
        <div style={actionsContainerStyle}>
          <Button variant="outline" onClick={() => { setError(''); setIsDeptModalOpen(true); }}>
            <FolderPlus size={16} /> Department
          </Button>
          <Button variant="outline" onClick={() => { setError(''); setIsRoleModalOpen(true); }}>
            <Award size={16} /> Job Role
          </Button>
          <Button variant="primary" onClick={openAddEmpModal}>
            <UserPlus size={16} /> Add Employee
          </Button>
        </div>
      </div>

      <Card>
        <Table 
          headers={['ID', 'Name', 'Email', 'Department', 'Job Role', 'Status', 'Actions']}
          isEmpty={employees.length === 0}
        >
          {employees.map((emp) => (
            <tr key={emp.id}>
              <td><strong>{emp.id}</strong></td>
              <td>{emp.first_name} {emp.last_name}</td>
              <td>{emp.email}</td>
              <td>{emp.department_name || 'Unassigned'}</td>
              <td>{emp.role_name || 'Unassigned'}</td>
              <td>
                <span className={`badge ${emp.status === 'active' ? 'badge-success' : 'badge-danger'}`}>
                  {emp.status}
                </span>
              </td>
              <td>
                <div style={rowActionsStyle}>
                  <button onClick={() => openEditEmpModal(emp)} style={actionBtnStyle}>
                    <Edit2 size={16} color="var(--primary-color)" />
                  </button>
                  {emp.id !== 'EMP-2026-0001' && (
                    <button onClick={() => handleDeleteEmp(emp.id)} style={actionBtnStyle}>
                      <Trash2 size={16} color="var(--danger-color)" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {/* 1. Add/Edit Employee Modal */}
      <Modal 
        isOpen={isEmpModalOpen} 
        onClose={() => setIsEmpModalOpen(false)} 
        title={empForm.id ? "Edit Employee Profile" : "Register New Employee"}
      >
        <form onSubmit={handleEmpSubmit}>
          {error && <div style={errorStyle}>{error}</div>}

          <div style={formRowStyle}>
            <Input
              label="First Name"
              id="first_name"
              name="first_name"
              value={empForm.first_name}
              onChange={handleEmpChange}
              required
            />
            <Input
              label="Last Name"
              id="last_name"
              name="last_name"
              value={empForm.last_name}
              onChange={handleEmpChange}
              required
            />
          </div>

          <Input
            label="Email Address"
            id="email"
            name="email"
            type="email"
            value={empForm.email}
            onChange={handleEmpChange}
            required
          />

          {!empForm.id && (
            <Input
              label="Password"
              id="password"
              name="password"
              type="password"
              value={empForm.password}
              onChange={handleEmpChange}
              required
            />
          )}

          <Input
            label="Phone"
            id="phone"
            name="phone"
            value={empForm.phone}
            onChange={handleEmpChange}
          />

          <div style={formRowStyle}>
            <Input
              label="Department"
              id="department_id"
              name="department_id"
              type="select"
              value={empForm.department_id}
              onChange={handleEmpChange}
              options={departments.map(d => ({ value: d.id, label: d.name }))}
              required
            />
            <Input
              label="Job Role"
              id="role_id"
              name="role_id"
              type="select"
              value={empForm.role_id}
              onChange={handleEmpChange}
              options={roles.map(r => ({ value: r.id, label: r.name }))}
              required
            />
          </div>

          <div style={formRowStyle}>
            <Input
              label="Hire Date"
              id="hire_date"
              name="hire_date"
              type="date"
              value={empForm.hire_date}
              onChange={handleEmpChange}
              required
            />
            {empForm.id && (
              <Input
                label="Status"
                id="status"
                name="status"
                type="select"
                value={empForm.status}
                onChange={handleEmpChange}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' }
                ]}
                required
              />
            )}
          </div>

          <div style={modalFooterStyle}>
            <Button variant="outline" onClick={() => setIsEmpModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={actionLoading}>Save Changes</Button>
          </div>
        </form>
      </Modal>

      {/* 2. Add Department Modal */}
      <Modal isOpen={isDeptModalOpen} onClose={() => setIsDeptModalOpen(false)} title="Create Department">
        <form onSubmit={handleDeptSubmit}>
          {error && <div style={errorStyle}>{error}</div>}
          <Input
            label="Department Name"
            id="dept_name"
            value={deptForm.name}
            onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
            required
          />
          <Input
            label="Description"
            id="dept_desc"
            type="textarea"
            value={deptForm.description}
            onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })}
          />
          <div style={modalFooterStyle}>
            <Button variant="outline" onClick={() => setIsDeptModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={actionLoading}>Save</Button>
          </div>
        </form>
      </Modal>

      {/* 3. Add Role Modal */}
      <Modal isOpen={isRoleModalOpen} onClose={() => setIsRoleModalOpen(false)} title="Create Job Role">
        <form onSubmit={handleRoleSubmit}>
          {error && <div style={errorStyle}>{error}</div>}
          <Input
            label="Role Name"
            id="role_name"
            value={roleForm.name}
            onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
            required
          />
          <Input
            label="Description"
            id="role_desc"
            type="textarea"
            value={roleForm.description}
            onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
          />
          <div style={modalFooterStyle}>
            <Button variant="outline" onClick={() => setIsRoleModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={actionLoading}>Save</Button>
          </div>
        </form>
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
  marginBottom: '2rem',
};

const actionsContainerStyle = {
  display: 'flex',
  gap: '0.75rem',
};

const rowActionsStyle = {
  display: 'flex',
  gap: '0.75rem',
};

const actionBtnStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '0.25rem',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const formRowStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '1rem',
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

export default Employees;
