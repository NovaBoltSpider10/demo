-- TourMarket Data Loading Script (load.sql)

USE tourmarket;

-- Disable foreign key checks temporarily during bulk loading
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Load Customer Data
LOAD DATA LOCAL INFILE 'C:/Users/drive/Downloads/demo/customers.csv'
INTO TABLE Customer
FIELDS TERMINATED BY ',' 
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
(customer_user_id, first_name, last_name, email, phone);

-- 2. Load FleetBusiness Data
LOAD DATA LOCAL INFILE 'C:/Users/drive/Downloads/demo/fleet_business.csv'
INTO TABLE FleetBusiness
FIELDS TERMINATED BY ',' 
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
(fleet_business_id, business_name, contact_person, business_phone, business_email, operating_hours, address);

-- 3. Load Driver Data
LOAD DATA LOCAL INFILE 'C:/Users/drive/Downloads/demo/driver.csv'
INTO TABLE Driver
FIELDS TERMINATED BY ',' 
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
(driver_id, fleet_business_id, first_name, last_name, date_of_birth, sex, address, pincode, email, phone, experience_years, rating, available);

-- 4. Load Vehicle Data
LOAD DATA LOCAL INFILE 'C:/Users/drive/Downloads/demo/vehicle.csv'
INTO TABLE Vehicle
FIELDS TERMINATED BY ',' 
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
(vehicle_id, fleet_business_id, make, model, model_year, license_plate, color, capacity, type, hourly_rate, vehicle_class, fuel_type);

-- 5. Load TourRequest Data
LOAD DATA LOCAL INFILE 'C:/Users/drive/Downloads/demo/tour_request.csv'
INTO TABLE TourRequest
FIELDS TERMINATED BY ',' 
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
(tour_request_id, customer_user_id, matched_fleet_business_id, pickup_location, destination_location, tour_duration_option, tour_start_date, tour_end_date, vehicle_type, bags_count, contact_phone, fare, status);

-- 6. Load Booking Data
LOAD DATA LOCAL INFILE 'C:/Users/drive/Downloads/demo/booking.csv'
INTO TABLE Booking
FIELDS TERMINATED BY ',' 
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
(booking_id, tour_request_id, driver_id, vehicle_id, start_time, end_time, distance, fare, status);

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;