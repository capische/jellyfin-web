import React from 'react';
import Page from 'components/Page';
import { SignIn } from '../design/SignIn';

export default function SignInPage() {
    return <Page id='loginPage' className='standalonePage jfmod-signinPage' isBackButtonEnabled={false} isNowPlayingBarEnabled={false}>
        <SignIn />
    </Page>;
}
