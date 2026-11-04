import React from 'react';
import SetupBanner from '../components/SetupBanner';
import TraktReconnectNotice from '../components/TraktReconnectNotice';
import { Root } from './Root';

/** ds2.js Home notices; their original hooks and commands remain the owners. */
export const HomeNotices = () => <Root><SetupBanner /><TraktReconnectNotice /></Root>;
