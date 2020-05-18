import moment from 'moment';
import flatten from 'lodash/flatten';
import { AirBnbClient } from 'airbnb-private-api';
import { fs } from 'fs';

import {
  ACTIVITY_TYPE_PURCHASE,
  PURCHASE_CATEGORY_ENTERTAINMENT_HOTEL,
  UNIT_ITEM,
} from '../../definitions';

const config = {
  label: 'Airbnb',
  description:
    'Find adventures nearby or in faraway places and access unique homes, experiences, and places around the world',
  type: ACTIVITY_TYPE_PURCHASE,
  isPrivate: true,
  // minRefreshInterval: 60
  version: 1,
};

const sessionPath = './airbnb';

async function fetchLodging(client, modifiedSince, logger) {
  const response = await client._get_reservations({
    _limit: 50,
    _offset: 0,
    order_by: 'start_date',
    end_date: moment(modifiedSince).format('YYYY-MM-DD'),
  });
  const data = JSON.parse(response);
  console.log('Reservation list: ', data);
  let objects = data.LodgingObject;
  if (!objects) {
    return { activities: [], modifiedSince: data.timestamp };
  }
  if (!Array.isArray(objects)) {
    objects = [objects];
  }

  const activities = objects.map(s => {
    try {
      const [startDate, endDate] = [s.StartDateTime, s.EndDateTime];
      if (s.number_rooms != null && parseInt(s.number_rooms, 10) !== 1) {
        logger.logWarning(`Skipping item having multiple rooms: ${JSON.stringify(s)}`);
        return null;
      }
      const locationLon = s.Address ? parseFloat(s.Address.longitude) : null;
      const locationLat = s.Address ? parseFloat(s.Address.latitude) : null;
      const participants = s.number_guests ? parseInt(s.number_guests, 10) : null;
      return {
        id: s.id,
        activityType: ACTIVITY_TYPE_PURCHASE,
        lineItems: [
          { identifier: PURCHASE_CATEGORY_ENTERTAINMENT_HOTEL, unit: UNIT_ITEM, value: 1 },
        ],
        countryCodeISO2: s.Address ? s.Address.country : null,
        locationLon,
        locationLat,
        locationLabel: s.display_name,
        label: s.display_name,
        carrier: s.booking_site_name,
        datetime: startDate,
        endDatetime: endDate.getTime() - startDate.getTime() <= 0 ? null : endDate,
        participants,
      };
    } catch (e) {
      logger.logWarning(`Skipping item having error: ${e}`);
      return null;
    }
  });
  return { activities, modifiedSince: data.timestamp };
}

async function connect(requestLogin, requestWebView) {
  const { username, password } = await requestLogin();
  const client = new AirBnbClient({
    email: username,
    password,
    session_path: sessionPath,
  });
  const response = await client._authentication_by_email();
  console.log('Login details: ', response);
  return {
    username,
    password,
  };
  return {};
}

async function disconnect() {
  fs.rmdirSync(sessionPath, { recursive: true });
  return {};
}

async function collect(state = {}, logger) {
  const client = new AirBnbClient({
    email: state.username,
    password: state.password,
    session_path: sessionPath,
  });
  await client._load_session();

  logger.logDebug(`Initiating collect() with lastModifiedSince=${state.lastModifiedSince}`);
  if (!state.lastModifiedSince) {
    state.lastModifiedSince = new Date(Date.now());
  }
  const allResults = await Promise.all([
    fetchLodging(client, state.lastModifiedSince, logger), // past
  ]);

  return {
    activities: flatten(allResults.map(d => d.activities)).filter(d => d),
    state: {
      ...state,
      lastModifiedSince: Math.max(...allResults.map(d => d.modifiedSince)),
      version: config.version,
    },
  };
}

export default {
  connect,
  disconnect,
  collect,
  config,
};
