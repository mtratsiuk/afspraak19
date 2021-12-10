#!/usr/bin/env node

// @ts-check

import assert from "assert"
import fetch from "node-fetch"
import inquirer from "inquirer"
import chalk from "chalk"

import config from "./config.js"


const BASE_URL = "https://apim.testenvoortoegang.org/api"
const USER_AGENT = "Mozilla/5.0 (X11; Fedora; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36 Mishromium 0.0.1"


async function main () {
  const currentDate = new Date()

  const events = await get("/events/getevents/TestenVoorToegang")
  assert.ok(Array.isArray(events))

  const { eventId: eventTypeId } = await inquirer.prompt({
    type: "list",
    name: "eventId",
    message: "So... Why do you need to have a stick inside your nose today?",
    choices: events
      .filter(({ blocked }) => !blocked)
      .map(({ id, nameEn, testType: { nameEn: type, resultWaitPeriod, validityPeriod } }) => ({ name: `${nameEn} | ${type} | wait: ${resultWaitPeriod}min | valid: ${validityPeriod}h`, value: id }))
  })

  const locationsParams = {
    lat: config.lat,
    lng: config.lng,
    amount: 5,
    eventTypeId
  }
  const locations = await get(`/locations/getlocations?${query(locationsParams)}`)
  assert.ok(Array.isArray(locations))

  const { locationId } = await inquirer.prompt({
    type: "list",
    name: "locationId",
    message: "Where would you like to have this experience?",
    choices: locations
      .filter(({ isActive }) => isActive)
      .map(({ id, address, distanceInKm, testProvider: { nameEn } }) => ({ name: `${distanceInKm} | ${nameEn} | ${address}`, value: id }))
  })

  const slotsParams = {
    date: currentDate.toISOString(),
    eventDate: new Date(new Date(currentDate).setHours(23)).toISOString(),
    eventTypeId
  }
  const slots = await get(`/timeslots/get/${locationId}?${query(slotsParams)}`)
  assert.ok(Array.isArray(slots))

  const { timeSlot } = await inquirer.prompt({
    type: "list",
    name: "timeSlot",
    message: "And when?",
    choices: slots
      .filter(({ hasAvailability }) => hasAvailability)
      .map(({ startTimeslot, bookings, maximumCapacity }) => ({
        name: `${new Date(startTimeslot).toLocaleTimeString()} ${new Date(startTimeslot).toLocaleDateString()} | Booked: ${bookings} / ${maximumCapacity}`,
        value: startTimeslot
      }))
  })

  const requestSmsParams = {
    phone: config.testee.mobilePhone,
    lang: config.testee.preferredLanguage,
    portal: "TestenVoorToegang"
  }
  await post(`/smstokens/requestnew?${query(requestSmsParams)}`)
  console.log(chalk.cyan("Verification code was sent to your number..."))

  const { code } = await inquirer.prompt({
    type: "input",
    name: "code",
    message: "Please enter verification code from sms:"
  })

  const validateSmsParams = {
    phone: config.testee.mobilePhone
  }
  const { tokenId: smsVerificationId } = await get(`/smstokens/validate/${code}?${query(validateSmsParams)}`)
  console.log(chalk.cyan(`Your phone number was successfully verified: ${smsVerificationId}`))

  const createReservationParams = {
    locationId,
    smsVerificationId,
    timeSlot
  }
  const { id: reservationId } = await post(`/reservations/createreservation`, createReservationParams)
  console.log(chalk.cyan(`Reservation created: ${reservationId}`))

  const createBookingParams = {
    bookingDate: timeSlot,
    eventTypeId,
    reservationId,
    locationId,
    firstName: config.testee.firstName,
    prefix: null,
    surveyOptIn: false,
    lastName: config.testee.lastName,
    emailAddress: config.testee.emailAddress,
    dateOfBirth: config.testee.dateOfBirth,
    preferredLanguage: config.testee.preferredLanguage,
    mobilePhone: config.testee.mobilePhone,
    smsVerificationId
  }

  console.log(chalk.cyan(`Ready to create a booking with params:`))
  console.log(createBookingParams)
  const { confirmed } = await inquirer.prompt({
    type: "confirm",
    name: "confirmed",
    message: "Everything seems fine?"
  })

  if (!confirmed) {
    console.log(chalk.gray(`Oh well... Bye then :)`))
    return
  }

  console.log(chalk.cyan(`Booking afspraak...`))
  const { id, bookingCode } = await post(`/bookings/createbooking`, createBookingParams)
  console.log(chalk.cyan(`Booking created: ${id} | ${bookingCode}`))
  console.log(chalk.magenta(`Enjoy!`))
}

/**
 *
 * @param {Record<string, any>} params
 * @returns {string}
 */
const query = params => {
  return new URLSearchParams(params).toString()
}

/**
 * @param {"GET"|"POST"} method
 * @returns {(post: string, body?: Record<string, any>) => Promise<any>}
 */
const request = method => async (path, body) => {
  debug(method, path, body)

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body && { "content-type": "application/json" }),
      "user-agent": USER_AGENT
    },
    body: body && JSON.stringify(body)
  })

  let responseBody

  try {
    responseBody = await response.json()
  } catch (error) {
    throw new Error(`Failed to parse response for ${path}: ${JSON.stringify(error)}`)
  }

  if (response.status >= 300) {
    throw new Error(`Http error for ${path}: [${response.status}]: ${JSON.stringify(responseBody)}`)
  }

  debug("Received:", response.status, responseBody)

  return responseBody
}

const get = request("GET")

const post = request("POST")

const debugEnabled = process.argv.includes("-d") || process.argv.includes("--debug")
const debug = (...args) => {
  if (!debugEnabled) {
    return
  }

  console.debug(...args)
}

main()
