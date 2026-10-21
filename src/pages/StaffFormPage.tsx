import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { DEPARTMENTS } from '../types';
import { useAuth } from '../auth/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorBanner from '../components/ErrorBanner';

interface StaffFormData {
  employee_id: string;
  name: string;
  designation: string;
  department: string;
  phone: string;
  email: string;
  notify_absence: boolean;
  notify_monthly_report: boolean;
  joining_date: string;
  leaving_date: string;
  default_shift: string;
  is_active: boolean;
}

const emptyForm: StaffFormData = {
  employee_id: '',
  name: '',
  designation: '',
  department: '',
  phone: '',
  email: '',
  notify_absence: false,
  notify_monthly_report: false,
  joining_date: '',
  leaving_date: '',
  default_shift: '',
  is_active: true,
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function StaffFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const isEdit = Boolean(id);

  const [form, setForm] = useState<StaffFormData>(emptyForm);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const fetchStaff = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.getStaff(id);
      const s = (data as any).staff;
      setForm({
        employee_id: s.employee_id || '',
        name: s.full_name || s.name || '',
        designation: s.designation || '',
        department: s.department || '',
        phone: s.phone || '',
        email: s.email || '',
        notify_absence: Boolean(s.notify_absence),
        notify_monthly_report: Boolean(s.notify_monthly_report),
        joining_date: s.joining_date || '',
        leaving_date: s.leaving_date || '',
        default_shift: s.default_shift || '',
        is_active: s.is_active !== false,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load staff details');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (isEdit) fetchStaff();
  }, [isEdit, fetchStaff]);

  const updateField = (field: keyof StaffFormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!form.employee_id.trim()) errors.employee_id = 'Employee ID is required';
    if (!form.name.trim()) errors.name = 'Full Name is required';
    if (!form.designation.trim()) errors.designation = 'Designation is required';
    if (!form.department) errors.department = 'Department is required';
    if (!form.joining_date) errors.joining_date = 'Joining Date is required';
    if (form.email.trim() && !EMAIL_REGEX.test(form.email.trim())) {
      errors.email = 'Invalid email address format';
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setError('');
    try {
      const payload: any = {
        employee_id: form.employee_id.trim(),
        full_name: form.name.trim(),
        name: form.name.trim(),
        designation: form.designation.trim(),
        department: form.department,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || null,
        joining_date: form.joining_date,
        default_shift: form.default_shift.trim() || undefined,
      };

      if (isOwner) {
        payload.notify_absence = form.notify_absence;
        payload.notify_monthly_report = form.notify_monthly_report;
      }

      if (isEdit) {
        payload.leaving_date = form.leaving_date || undefined;
        payload.is_active = form.is_active;
        await api.updateStaff(id!, payload);
      } else {
        await api.createStaff(payload);
      }
      navigate('/staff');
    } catch (err: any) {
      setError(err.message || 'Failed to save staff');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{isEdit ? 'Edit Staff' : 'Add Staff'}</h1>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="card" style={{ maxWidth: '640px', padding: '1.5rem' }}>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Employee ID */}
            <div>
              <label className="label">
                Employee ID <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={form.employee_id}
                onChange={(e) => updateField('employee_id', e.target.value)}
                className="input"
                disabled={isEdit}
                placeholder="e.g. EMP001"
              />
              {validationErrors.employee_id && (
                <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>{validationErrors.employee_id}</span>
              )}
            </div>

            {/* Full Name */}
            <div>
              <label className="label">
                Full Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                className="input"
                placeholder="Staff full name"
              />
              {validationErrors.name && (
                <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>{validationErrors.name}</span>
              )}
            </div>

            {/* Designation */}
            <div>
              <label className="label">
                Designation <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={form.designation}
                onChange={(e) => updateField('designation', e.target.value)}
                className="input"
                placeholder="e.g. Receptionist, Chef"
              />
              {validationErrors.designation && (
                <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>{validationErrors.designation}</span>
              )}
            </div>

            {/* Department */}
            <div>
              <label className="label">
                Department <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select
                value={form.department}
                onChange={(e) => updateField('department', e.target.value)}
                className="input"
              >
                <option value="">Select department</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              {validationErrors.department && (
                <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>{validationErrors.department}</span>
              )}
            </div>

            {/* Phone & Email (2-column on wider screens) */}
            <div className="form-row">
              <div>
                <label className="label">Phone Number</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  className="input"
                  placeholder="e.g. 9876543210 (optional)"
                />
              </div>
              <div>
                <label className="label">Staff Email Address</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  className="input"
                  placeholder="staff@example.com (optional)"
                />
                {validationErrors.email && (
                  <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>{validationErrors.email}</span>
                )}
              </div>
            </div>

            {/* Email Notifications Settings (Owner only) */}
            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1B2A4A', marginBottom: '0.5rem' }}>
                Email Notifications Settings {isOwner ? '' : '(Owner Only)'}
              </div>
              <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 0.75rem 0' }}>
                Staff without an email will work normally without notifications.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: form.email ? 'pointer' : 'not-allowed' }}>
                  <input
                    type="checkbox"
                    checked={form.notify_absence}
                    disabled={!isOwner || !form.email.trim()}
                    onChange={(e) => updateField('notify_absence', e.target.checked)}
                  />
                  <span style={{ fontSize: '0.85rem' }}>
                    Send automated alert when marked <strong>Absent</strong>
                  </span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: form.email ? 'pointer' : 'not-allowed' }}>
                  <input
                    type="checkbox"
                    checked={form.notify_monthly_report}
                    disabled={!isOwner || !form.email.trim()}
                    onChange={(e) => updateField('notify_monthly_report', e.target.checked)}
                  />
                  <span style={{ fontSize: '0.85rem' }}>
                    Send monthly attendance report summary on the 1st
                  </span>
                </label>
              </div>
              {!form.email.trim() && (
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                  Enter an email address above to enable notification options.
                </div>
              )}
            </div>

            {/* Joining Date */}
            <div>
              <label className="label">
                Joining Date <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="date"
                value={form.joining_date}
                onChange={(e) => updateField('joining_date', e.target.value)}
                className="input"
              />
              {validationErrors.joining_date && (
                <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>{validationErrors.joining_date}</span>
              )}
            </div>

            {/* Leaving Date (edit only) */}
            {isEdit && (
              <div>
                <label className="label">Leaving Date</label>
                <input
                  type="date"
                  value={form.leaving_date}
                  onChange={(e) => updateField('leaving_date', e.target.value)}
                  className="input"
                />
              </div>
            )}

            {/* Default Shift */}
            <div>
              <label className="label">Default Shift</label>
              <input
                type="text"
                value={form.default_shift}
                onChange={(e) => updateField('default_shift', e.target.value)}
                className="input"
                placeholder='e.g. Morning, Night (optional)'
              />
            </div>

            {/* Active checkbox (edit only) */}
            {isEdit && (
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => updateField('is_active', e.target.checked)}
                  />
                  <span className="label" style={{ margin: 0 }}>Active Employee</span>
                </label>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Saving…' : isEdit ? 'Update Staff' : 'Add Staff'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate('/staff')}
                disabled={submitting}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
