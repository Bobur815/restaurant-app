-- 4.task:
select employees.first_name as employee_name, count(orders.order_id) as orders_count from employees 
left join orders on orders.employee_id = employees.employee_id 
group by employees.employee_id, employees.first_name;

-- 5.task:
select products.product_name, sum(order_details.unit_price * order_details.quantity) as umumiy_savdo from products 
left join order_details on order_details.product_id=products.product_id 
group by products.product_name, order_details.product_id;

-- 6.task:
 select customers.city, count(*) as customer_count from customers group by city order by customer_count desc;

--  7.task:
select categories.category_name, sum(order_details.unit_price * order_details.quantity) as umumiy_savdo from products 
left join categories on products.category_id=categories.category_id 
join order_details on order_details.product_id=products.product_id 
group by categories.category_name order by umumiy_savdo desc;

-- 8.task:
select customers.company_name, sum(order_details.unit_price * order_details.quantity) as umumiy_savdo from customers left join
orders on orders.customer_id = customers.customer_id inner join order_details on order_details.order_id=orders.order_id 
group by customers.company_name order by umumiy_savdo desc;

-- 9.task:

select employees.first_name, sum(order_details.unit_price * order_details.quantity) AS umumiy_savdo
from employees left join orders on orders.employee_id= employees.employee_id
inner join order_details on orders.order_id=order_details.order_id
group by employees.first_name
order by umumiy_savdo desc;

-- 10.task:
select products.product_name, avg(products.unit_price) as "o'rtacha narx" from products 
group by products.product_name order by "o'rtacha narx" desc;

-- 11.task:

select o.ship_city, sum(od.unit_price * od.quantity) as umumiy_savdo from orders as o left join order_details as od on o.order_id=od.order_id
    -> group by o.ship_city;

    -- 12.task:
select s.company_name as yetkazib_beruvchi, AVG(p.unit_price) as ortacha_nar from suppliers as s
join products as p on s.supplier_id = p.supplier_id
group by s.company_name
group byortacha_narx desc;

-- 13.task:
select p.product_name, sum(od.quantity) AS umumiy_buyurtma_miqdori
from products AS p
JOIN order_details AS od ON p.product_id = od.product_id
GROUP BY p.product_name
ORDER BY umumiy_buyurtma_miqdori DESC;

