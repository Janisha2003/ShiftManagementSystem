from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from app.backend.models.employee import Employee
from app.backend.models.user import User
from app.backend.models.department import Department
from app.backend.models.role import Role
from app.backend.extensions import db
from app.backend.middleware import role_required

employee_bp = Blueprint('employee', __name__)

@employee_bp.route('', methods=['GET'])
@jwt_required()
@role_required(['admin', 'manager'])
def list_employees():
    """Returns a list of all employees in the database"""
    employees = Employee.query.all()
    return jsonify([emp.to_dict() for emp in employees]), 200

@employee_bp.route('', methods=['POST'])
@jwt_required()
@role_required(['admin'])
def create_employee():
    """Creates a new user credentials record and corresponding employee profile"""
    data = request.get_json() or {}
    email = data.get('email')
    password = data.get('password')
    first_name = data.get('first_name')
    last_name = data.get('last_name')
    phone = data.get('phone')
    department_id = data.get('department_id')
    role_id = data.get('role_id')
    hire_date_str = data.get('hire_date')

    if not all([email, password, first_name, last_name]):
        return jsonify({'message': 'Email, password, first name and last name are required'}), 400

    # Check if user already exists
    if User.query.filter_by(email=email).first():
        return jsonify({'message': 'An account with this email already exists'}), 409

    # Generate custom employee ID
    emp_id = Employee.generate_id()

    try:
        # Create User
        user = User(email=email, role='employee')
        user.set_password(password)
        db.session.add(user)
        db.session.flush()  # Flush to get user.id for employee record

        # Parse date
        hire_date = None
        if hire_date_str:
            from datetime import datetime
            hire_date = datetime.strptime(hire_date_str, '%Y-%m-%d').date()

        # Create Employee
        employee = Employee(
            id=emp_id,
            user_id=user.id,
            first_name=first_name,
            last_name=last_name,
            phone=phone,
            department_id=department_id,
            role_id=role_id,
            hire_date=hire_date
        )
        db.session.add(employee)
        db.session.commit()
        return jsonify(employee.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': 'Failed to create employee profile', 'error': str(e)}), 500

@employee_bp.route('/<emp_id>', methods=['GET'])
@jwt_required()
def get_employee(emp_id):
    """Retrieves profile details for a single employee"""
    employee = Employee.query.filter_by(id=emp_id).first()
    if not employee:
        return jsonify({'message': 'Employee not found'}), 404
    return jsonify(employee.to_dict()), 200

@employee_bp.route('/<emp_id>', methods=['PUT'])
@jwt_required()
def update_employee(emp_id):
    """Updates an employee profile (Admins can change any detail, Employees can only change phone)"""
    from flask_jwt_extended import get_current_user
    current_user = get_current_user()
    
    employee = Employee.query.filter_by(id=emp_id).first()
    if not employee:
        return jsonify({'message': 'Employee not found'}), 404

    # Enforce role logic: employees can only edit their own profile
    if current_user.role == 'employee' and current_user.id != employee.user_id:
        return jsonify({'message': 'Unauthorized to modify another employee\'s profile'}), 403

    data = request.get_json() or {}
    
    if current_user.role in ['admin', 'manager']:
        employee.first_name = data.get('first_name', employee.first_name)
        employee.last_name = data.get('last_name', employee.last_name)
        employee.phone = data.get('phone', employee.phone)
        employee.department_id = data.get('department_id', employee.department_id)
        employee.role_id = data.get('role_id', employee.role_id)
        employee.status = data.get('status', employee.status)
        
        # Sync email
        new_email = data.get('email')
        if new_email and new_email != employee.user.email:
            if User.query.filter(User.email == new_email, User.id != employee.user_id).first():
                return jsonify({'message': 'Email address already in use'}), 409
            employee.user.email = new_email
    else:
        # Employee modifying their own profile
        employee.phone = data.get('phone', employee.phone)

    try:
        db.session.commit()
        return jsonify(employee.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': 'Failed to update employee details', 'error': str(e)}), 500

@employee_bp.route('/<emp_id>', methods=['DELETE'])
@jwt_required()
@role_required(['admin'])
def delete_employee(emp_id):
    """Deletes an employee and their corresponding user record"""
    employee = Employee.query.filter_by(id=emp_id).first()
    if not employee:
        return jsonify({'message': 'Employee not found'}), 404

    try:
        # Fetch associated user
        user = employee.user
        db.session.delete(employee)
        if user:
            db.session.delete(user)
        db.session.commit()
        return jsonify({'message': 'Employee and user profile successfully deleted'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': 'Failed to delete employee profile', 'error': str(e)}), 500


# Departments CRUD helper endpoints — must be defined BEFORE /<emp_id> routes
@employee_bp.route('/departments', methods=['GET'])
@jwt_required()
def list_departments():
    """Lists all registered departments"""
    departments = Department.query.all()
    return jsonify([d.to_dict() for d in departments]), 200

@employee_bp.route('/departments', methods=['POST'])
@jwt_required()
@role_required(['admin', 'manager'])
def create_department():
    """Creates a new department category"""
    data = request.get_json() or {}
    name = data.get('name')
    description = data.get('description')

    if not name:
        return jsonify({'message': 'Department name is required'}), 400

    if Department.query.filter_by(name=name).first():
        return jsonify({'message': 'Department with this name already exists'}), 409

    try:
        dept = Department(name=name, description=description)
        db.session.add(dept)
        db.session.commit()
        return jsonify(dept.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': 'Failed to save department', 'error': str(e)}), 500


# Job Roles CRUD helper endpoints
@employee_bp.route('/roles', methods=['GET'])
@jwt_required()
def list_roles():
    """Lists all registered job roles"""
    roles = Role.query.all()
    return jsonify([r.to_dict() for r in roles]), 200

@employee_bp.route('/roles', methods=['POST'])
@jwt_required()
@role_required(['admin', 'manager'])
def create_role():
    """Creates a new job role category"""
    data = request.get_json() or {}
    name = data.get('name')
    description = data.get('description')

    if not name:
        return jsonify({'message': 'Role name is required'}), 400

    if Role.query.filter_by(name=name).first():
        return jsonify({'message': 'Role with this name already exists'}), 409

    try:
        role = Role(name=name, description=description)
        db.session.add(role)
        db.session.commit()
        return jsonify(role.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': 'Failed to save job role', 'error': str(e)}), 500
