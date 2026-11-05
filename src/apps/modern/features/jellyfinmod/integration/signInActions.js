import createDOMPurify from 'dompurify';
import markdownIt from 'markdown-it';
import loading from 'components/loading/loading';
import toast from 'components/toast/toast';
import dialogHelper from 'components/dialogHelper/dialogHelper';
import baseAlert from 'components/alert';
import Dashboard from 'utils/dashboard';
import globalize from 'lib/globalize';

const domPurify = createDOMPurify();
domPurify.setConfig({
    // eslint-disable-next-line @typescript-eslint/naming-convention, sonarjs/regex-complexity -- DOMPurify config option; customizes its default regex
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|callto|cid|xmpp|matrix|tg|whatsapp|signal|ircs?):|[^a-z]|[a-z+.-]+(?:[^-a-z+.:]|$))/i
});

export const sanitizeSignInDisclaimer = text => {
    // eslint-disable-next-line sonarjs/disabled-auto-escaping -- DOMPurify sanitizes the rendered Markdown.
    return domPurify.sanitize(markdownIt({ html: true }).render(text || ''));
};

// The login controller's original authentication and navigation actions, shared by both presentations.
export function authenticateUserByName(page, apiClient, url, username, password) {
    loading.show();
    return apiClient.authenticateUserByName(username, password).then(function (result) {
        const user = result.User;
        loading.hide();

        onLoginSuccessful(user.Id, result.AccessToken, apiClient, url);
        return true;
    }, function (response) {
        const passwordInput = page.querySelector('#txtManualPassword');
        if (passwordInput) passwordInput.value = '';
        loading.hide();

        const UnauthorizedOrForbidden = [401, 403];
        if (UnauthorizedOrForbidden.includes(response.status)) {
            const messageKey = response.status === 401 ? 'MessageInvalidUser' : 'MessageUnauthorizedUser';
            toast(globalize.translate(messageKey));
        } else {
            Dashboard.alert({
                message: globalize.translate('MessageUnableToConnectToServer'),
                title: globalize.translate('HeaderConnectionFailure')
            });
        }
        return response.status || 0;
    });
}

export function authenticateQuickConnect(apiClient, targetUrl, onFinished) {
    const url = apiClient.getUrl('/QuickConnect/Initiate');
    return apiClient.ajax({ type: 'POST', url }, true).then(res => res.json()).then(function (json) {
        if (!json.Secret || !json.Code) {
            console.error('Malformed quick connect response', json);
            onFinished?.();
            return false;
        }

        let active = true;
        let reading = false;
        const stop = () => {
            if (!active) return;
            active = false;
            clearInterval(interval);
            onFinished?.();
            const dlg = document.getElementById('quickConnectAlert');
            if (dlg) dialogHelper.close(dlg);
        };
        const failed = e => {
            if (!active) return;
            stop();
            Dashboard.alert({
                message: globalize.translate('QuickConnectDeactivated'),
                title: globalize.translate('HeaderError')
            });
            console.error('Unable to login with quick connect', e);
        };

        baseAlert({
            dialogOptions: {
                id: 'quickConnectAlert'
            },
            title: globalize.translate('QuickConnect'),
            text: globalize.translate('QuickConnectAuthorizeCode', json.Code)
        }).then(stop, stop);

        const connectUrl = apiClient.getUrl('/QuickConnect/Connect?Secret=' + json.Secret);

        const interval = setInterval(function() {
            if (!active || reading) return;
            reading = true;
            apiClient.getJSON(connectUrl).then(async function(data) {
                if (!active || !data.Authenticated) return;
                clearInterval(interval);
                const result = await apiClient.quickConnect(data.Secret);
                if (!active) return;
                stop();
                onLoginSuccessful(result.User.Id, result.AccessToken, apiClient, targetUrl);
            }).catch(failed).finally(() => { reading = false; });
        }, 5000);

        return stop;
    }, function(e) {
        onFinished?.();
        Dashboard.alert({
            message: globalize.translate('QuickConnectNotActive'),
            title: globalize.translate('HeaderError')
        });

        console.error('Quick connect error: ', e);
        return false;
    });
}

function onLoginSuccessful(id, accessToken, apiClient, url) {
    Dashboard.onServerChanged(id, accessToken, apiClient);
    Dashboard.navigate(url || 'home');
}

