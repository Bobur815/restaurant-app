CREATE DATABASE IF NOT EXISTS vazifa_16_dars;

USE vazifa_16_dars;

CREATE TABLE IF NOT EXISTS employees(
    id INT auto_increment primary key,
    name varchar(20) not null,
    salary int not null,
    departments varchar(20) not null
);

CREATE TABLE if NOT EXISTS log_actions(
    id INT auto_increment primary key,
    employee_id int,
    log_action varchar(20),
    log_time datetime
);

delimiter $$
create trigger before_log_employee_update
before insert on employees
for each row
begin
    if new.salary > 1000 then
        set new.salary=1000;
    end if;
end $$

delimiter ;
create trigger log_employee_update
after update on employees
for each row
begin
    insert into log_actions (employee_id,log_action,log_time)
    values(NEW.id,"Update",now());
end $$

delimiter $$
create trigger log_employee_insert
after insert on employees
for each row
begin
    insert into log_actions (employee_id,log_action,log_time)
    values(NEW.id,"Insert",now());
end $$

create trigger log_employee_delete
after delete on employees
for each row
begin
    insert into log_actions (employee_id,log_action,log_time)
    values(OLD.id,"Delete",now());
end $$
delimiter ;

INSERT INTO employees (name, salary, departments) values
('Ali',2000,'IT'),
('Dildora',2500,'HR'),
('Vali',1800,'Marketing'),
('Karim',5000,'Sales'),
('Bobur',4500,'IT'),
('Sobir',3400,'HR');

delimiter $$

create function hasBonus(e_id int)
returns varchar(10)
deterministic
begin
    if (select salary from employees e where e.id=e_id) > (select avg(salary) from employees) then
        return '20 %';
    else 
        return '0 %';
    end if;
end$$


create function calcBonus(e_id int)
returns int
deterministic
begin
    declare new_salary int;
    
    select salary into new_salary from employees where id = e_id;
    
    if hasBonus(e_id) = '20 %' then
        return new_salary * 1.2;
    else
        return new_salary;
    end if;
end$$
delimiter ;


SELECT *, hasBonus(id) as Bonus, calcBonus(id) as Salary_after_bonus from employees;


DROP function calcBonus;
DROP function hasBonus;
drop TABLE employees;
DROP DATABASE vazifa_16_dars;