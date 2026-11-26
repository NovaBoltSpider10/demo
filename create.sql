-- TourMarket Database Creation Script (create.sql)

CREATE DATABASE IF NOT EXISTS tourmarket;
USE tourmarket;

-- Drop existing tables in correct order of dependency
DROP TABLE IF EXISTS Booking;
DROP TABLE IF EXISTS TourRequest;
DROP TABLE IF EXISTS Vehicle;
DROP TABLE IF EXISTS Driver;
DROP TABLE IF EXISTS FleetBusiness;
DROP TABLE IF EXISTS Customer;

-- 1. Customer Table
CREATE TABLE Customer (
    customer_user_id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    phone VARCHAR(20) NOT NULL
) ENGINE=InnoDB;

-- 2. FleetBusiness Table
CREATE TABLE FleetBusiness (
    fleet_business_id INT AUTO_INCREMENT PRIMARY KEY,
    business_name VARCHAR(100) NOT NULL,
    contact_person VARCHAR(100) NOT NULL,
    business_phone VARCHAR(20) NOT NULL,
    business_email VARCHAR(100) NOT NULL UNIQUE,
    operating_hours VARCHAR(100) DEFAULT NULL,
    address VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

-- 3. Driver Table
CREATE TABLE Driver (
    driver_id INT AUTO_INCREMENT PRIMARY KEY,
    fleet_business_id INT NOT NULL,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    date_of_birth DATE NOT NULL,
    sex VARCHAR(20) DEFAULT NULL,
    address VARCHAR(255) DEFAULT NULL,
    pincode VARCHAR(10) DEFAULT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    phone VARCHAR(20) NOT NULL,
    experience_years DECIMAL(4,1) NOT NULL DEFAULT 0.0 CHECK (experience_years >= 0),
    rating DECIMAL(3,2) DEFAULT NULL CHECK (rating >= 0.00 AND rating <= 5.00),
    available BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_driver_fleet FOREIGN KEY (fleet_business_id) 
        REFERENCES FleetBusiness(fleet_business_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 4. Vehicle Table
CREATE TABLE Vehicle (
    vehicle_id INT AUTO_INCREMENT PRIMARY KEY,
    fleet_business_id INT NOT NULL,
    make VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    model_year YEAR NOT NULL,
    license_plate VARCHAR(20) NOT NULL UNIQUE,
    color VARCHAR(30) DEFAULT NULL,
    capacity INT NOT NULL CHECK (capacity > 0),
    type VARCHAR(50) NOT NULL,
    hourly_rate DECIMAL(10,2) NOT NULL CHECK (hourly_rate >= 0),
    vehicle_class VARCHAR(50) DEFAULT NULL,
    fuel_type VARCHAR(30) DEFAULT NULL,
    CONSTRAINT fk_vehicle_fleet FOREIGN KEY (fleet_business_id) 
        REFERENCES FleetBusiness(fleet_business_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 5. TourRequest Table
CREATE TABLE TourRequest (
    tour_request_id INT AUTO_INCREMENT PRIMARY KEY,
    customer_user_id INT NOT NULL,
    matched_fleet_business_id INT DEFAULT NULL,
    pickup_location VARCHAR(255) NOT NULL,
    destination_location VARCHAR(255) NOT NULL,
    tour_duration_option VARCHAR(50) NOT NULL,
    tour_start_date DATETIME NOT NULL,
    tour_end_date DATETIME NOT NULL,
    vehicle_type VARCHAR(50) DEFAULT NULL,
    bags_count INT NOT NULL DEFAULT 1 CHECK (bags_count >= 0),
    contact_phone VARCHAR(20) NOT NULL,
    fare DECIMAL(10,2) DEFAULT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'Pending',
    CONSTRAINT fk_request_customer FOREIGN KEY (customer_user_id) 
        REFERENCES Customer(customer_user_id) 
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_request_fleet FOREIGN KEY (matched_fleet_business_id) 
        REFERENCES FleetBusiness(fleet_business_id) 
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_dates CHECK (tour_end_date >= tour_start_date)
) ENGINE=InnoDB;

-- 6. Booking Table
CREATE TABLE Booking (
    booking_id INT AUTO_INCREMENT PRIMARY KEY,
    tour_request_id INT NOT NULL UNIQUE,
    driver_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    start_time DATETIME DEFAULT NULL,
    end_time DATETIME DEFAULT NULL,
    distance DECIMAL(10,2) DEFAULT NULL CHECK (distance >= 0),
    fare DECIMAL(10,2) DEFAULT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'Scheduled',
    CONSTRAINT fk_booking_request FOREIGN KEY (tour_request_id) 
        REFERENCES TourRequest(tour_request_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_booking_driver FOREIGN KEY (driver_id) 
        REFERENCES Driver(driver_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_booking_vehicle FOREIGN KEY (vehicle_id) 
        REFERENCES Vehicle(vehicle_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_booking_times CHECK (end_time IS NULL OR end_time >= start_time)
) ENGINE=InnoDB;

-- 7. Trigger to enforce Phase 2 Feedback:
-- Ensures that assigned driver and vehicle belong to the fleet matched to the tour request.
DELIMITER //

CREATE TRIGGER trg_check_booking_fleet
BEFORE INSERT ON Booking
FOR EACH ROW
BEGIN
    DECLARE req_fleet INT;
    DECLARE drv_fleet INT;
    DECLARE veh_fleet INT;

    -- Get matched fleet for the tour request
    SELECT matched_fleet_business_id INTO req_fleet 
    FROM TourRequest 
    WHERE tour_request_id = NEW.tour_request_id;

    IF req_fleet IS NULL THEN
        SIGNAL SQLSTATE '45000' 
        SET MESSAGE_TEXT = 'Error: Cannot create booking for a tour request that has no matched fleet business.';
    END IF;

    -- Get fleet for assigned driver
    SELECT fleet_business_id INTO drv_fleet 
    FROM Driver 
    WHERE driver_id = NEW.driver_id;

    -- Get fleet for assigned vehicle
    SELECT fleet_business_id INTO veh_fleet 
    FROM Vehicle 
    WHERE vehicle_id = NEW.vehicle_id;

    -- Validate consistency
    IF drv_fleet <> req_fleet OR veh_fleet <> req_fleet THEN
        SIGNAL SQLSTATE '45000' 
        SET MESSAGE_TEXT = 'Error: Assigned driver and vehicle must belong to the fleet business matched to the tour request.';
    END IF;
END;
//

DELIMITER ;