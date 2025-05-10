CREATE DATABASE IF NOT EXISTS vazifa_16_dars;

USE vazifa_16_dars;

CREATE TABLE students(
    id int auto_increment primary key,
    name varchar(20),
    age int,
    course varchar(20),
    grade int
);

INSERT INTO students (name,age,course,grade) values
('Ali',20,'Math',85),
('Dildora',21,'Physics',90),
('Vali',18,'English',84),
('Karim',25,'Math',96);

-- 1.task:
delimiter $$


delimiter ;

-- 2.task:
delimiter $$
create procedure getCourseGrade(in s_id int)
begin
    select course,grade from students where id=s_id;
end $$
delimiter ;

-- 3.task:

delimiter $$
create procedure addStudent(s_name varchar(20), s_age int)
begin
    INSERT into students (name,age) values(s_name,s_age);
end $$

delimiter ;

-- 4.task:

delimiter $$
create procedure getAllSubjects()
begin
    select course from students;
end $$
delimiter ;

CREATE DATABASE schoolDB;
use schoolDB;

CREATE TABLE Students(id INT, name VARCHAR(50), age INT, grade VARCHAR(5));
CREATE TABLE Subjects(id INT, name VARCHAR(50));
create TABLE Marks(student_id INT, subject_id INT, mark INT);

-- 1.task:
delimiter $$
create function salom_ber(str varchar(50))
returns varchar(30)
deterministic
begin
    return concat('Salom, ',str);
end $$

delimiter ;

-- 2.task:

delimiter $$
create function add_two_nums(n1 int, n2 int)
returns int
deterministic
begin
    return n1+n2;
end$$
delimiter ;

-- 3.task:
delimiter $$
create function juft_toq_tekshirish(n int)
returns varchar(50)
deterministic

begin 
    if n%2=0 then
        return concat(n,' - juft son');
    else
        return concat(n,' - toq son');
    end if;
end$$
delimiter ;

-- 4.task:

delimiter $$
create function takrorlash(str varchar(20),n int)
returns varchar(100)
deterministic

begin
    return repeat(str,n);
end $$

delimiter ;


DELIMITER $$

CREATE FUNCTION takrorlashs(str VARCHAR(20), n INT)
RETURNS VARCHAR(100)
DETERMINISTIC
BEGIN
    RETURN REPEAT(str, n);
END$$

DELIMITER ;
