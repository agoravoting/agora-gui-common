/**
 * This file is part of agora-gui-common.
 * Copyright (C) 2015-2016  Agora Voting SL <agora@agoravoting.com>

 * agora-gui-common is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.

 * agora-gui-common  is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.

 * You should have received a copy of the GNU Affero General Public License
 * along with agora-gui-common.  If not, see <http://www.gnu.org/licenses/>.
**/

angular.module('avRegistration')
  .directive(
    'avOpenidConnect',
    function(
      $cookies,
      $window,
      $location,
      ConfigService,
      Authmethod
    ) {
      // we use it as something similar to a controller here
      function link(scope, element, attrs)
      {
        // Maximum Oauth Login Timeout is 5 minutes
        var maxOAuthLoginTimeout = 1000 * 60 * 5;

        scope.csrf = null;

        // simply redirect to login
        function simpleRedirectToLogin()
        {
          if (scope.csrf)
          {
            $window.location.href = "/election/" + scope.csrf.eventId + "/public/login";
          } else  {
            $window.location.href = "/";
          }
        }

        // Returns the logout url if any from the appropiate openidprovider
        // TODO: logout asumes that you are using the first provider, so it
        // basically supports only one provider
        function getLogoutUri()
        {
          if (ConfigService.openIDConnectProviders.length === 0 || !ConfigService.openIDConnectProviders[0].logout_uri)
          {
            return false;
          }

          var eventId = null;
          if (scope.csrf)
          {
            eventId = scope.csrf.eventId;
          }

          var uri = ConfigService.openIDConnectProviders[0].logout_uri;
          uri = uri.replace("__EVENT_ID__", "" + eventId);

          var postfix = "_authevent_" + eventId;
          if (!!$cookies.get("id_token_" + postfix))
          {
            uri = uri.replace("__ID_TOKEN__", $cookies.get("id_token_" + postfix));

          // if __ID_TOKEN__ is there but we cannot replace it, we need to
          // directly redirect to the login, otherwise the URI might show an
          // error 500
          } else if (uri.indexOf("__ID_TOKEN__") > -1)
          {
            uri = "/election/" + eventId + "/public/login";
          }

          return uri;
        }

        scope.redirectingToUri = false;

        // Redirects to the login page of the respective event_id if any
        function redirectToLogin()
        {
          if (scope.redirectingToUri)
          {
            return;
          }

          scope.redirectingToUri = true;

          var eventId = null;
          if (scope.csrf)
          {
            eventId = scope.csrf.eventId;
          } else {
            $window.location.href = "/";
            return;
          }

          Authmethod.viewEvent(eventId)
            .then(
              function onSuccess(response)
              {
                if (response.data.status !== "ok" || !response.data.events || response.data.events.auth_method !== 'openid-connect' || !getLogoutUri())
                {
                  simpleRedirectToLogin();
                  return;
                }

                var postfix = "_authevent_" + eventId;
                var uri = getLogoutUri();
                $cookies.remove("id_token_" + postfix);
                $window.location.href = uri;
              },
              function onError(response)
              {
                simpleRedirectToLogin();
              }
            );
        }

        // Get the decoded value of a uri parameter from any uri. The uri does not
        // need to have any domain, it can start with the character "?"
        function getURIParameter(paramName, uri)
        {
            var paramName2 = paramName.replace(/[\[\]]/g, '\\$&');
            var rx = new RegExp('[?&]' + paramName2 + '(=([^&#]*)|&|#|$)');
            var params = rx.exec(uri);

            if (!params)
            {
                return null;
            }

            if (!params[2])
            {
                return '';
            }
            return decodeURIComponent(params[2].replace(/\+/g, ' '));
        }

        // validates the CSRF token
        function validateCsrfToken()
        {
            if (!$cookies.get('openid-connect-csrf'))
            {
                redirectToLogin();
                return null;
            }

            // validate csrf token format and data
            var csrf = scope.csrf = angular.fromJson($cookies.get('openid-connect-csrf'));
            var uri = "?" + $window.location.hash.substr(1);

            // NOTE: if you need to debug this callback, obtain the callback
            // URL, get the callback received in the server (to obtain the
            // nonce) that was received by the client and change the data here
            // accordingly and set here the debug break point, then execute
            // a line like the following in the comment.
            //
            // The only data that needs to be changed is the randomNonnce and
            // the eventId.
            //
            // csrf = scope.csrf = {
            //   randomNonce: 'something',
            //   randomState: getURIParameter("state", uri),
            //   created: Date.now(),
            //   eventId: 11111
            // };

            $cookies.remove('openid-connect-csrf');
            var isCsrfValid = (!!csrf &&
              angular.isObject(csrf) &&
              angular.isString(csrf.randomState) &&
              angular.isString(csrf.randomNonce) &&
              angular.isNumber(csrf.created) &&
              getURIParameter("state", uri) === csrf.randomState &&
              csrf.created - Date.now() < maxOAuthLoginTimeout
            );

            if (!isCsrfValid)
            {
                redirectToLogin();
                return null;
            }
            return true;
        }

        // Process an OpenId Connect callback coming from the provider, try to
        // validate the callback data and get the authentication token from our
        // server and redirect to vote
        function processOpenIdAuthCallback()
        {
            // validate csrf token from uri and from state in the hash
            validateCsrfToken();

            var uri = "?" + $window.location.hash.substr(1);

            var data = {
                id_token: getURIParameter("id_token", uri),
                provider: scope.csrf.providerId,
                nonce: scope.csrf.randomNonce
            };

            var options = {};
            if (ConfigService.cookies && ConfigService.cookies.expires) {
              options.expires = new Date();
              options.expires.setMinutes(options.expires.getMinutes() + ConfigService.cookies.expires);
            }

            var postfix = "_authevent_" + scope.csrf.eventId;
            $cookies.put("id_token_" + postfix, data.id_token, options);

            // Send the authentication request to our server
            Authmethod.login(data, scope.csrf.eventId)
                .then(
                  function onSuccess(response)
                  {
                    if (response.data.status === "ok")
                    {
                        scope.khmac = response.data.khmac;
                        var postfix = "_authevent_" + scope.csrf.eventId;
                        $cookies.put("authevent_" + scope.csrf.eventId, scope.csrf.eventId, options);
                        $cookies.put("userid" + postfix, response.data.username, options);
                        $cookies.put("user" + postfix, response.data.username, options);
                        $cookies.put("auth" + postfix, response.data['auth-token'], options);
                        $cookies.put("isAdmin" + postfix, false, options);
                        Authmethod.setAuth($cookies.get("auth" + postfix), scope.isAdmin, scope.csrf.eventId);

                        if (angular.isDefined(response.data['redirect-to-url']))
                        {
                            $window.location.href = response.data['redirect-to-url'];
                        }
                        else
                        {
                            // redirecting to vote link
                            Authmethod.getPerm("vote", "AuthEvent", scope.csrf.eventId)
                                .then(function onSuccess(response2)
                                {
                                    var khmac = response2.data['permission-token'];
                                    var path = khmac.split(";")[1];
                                    var hash = path.split("/")[0];
                                    var msg = path.split("/")[1];
                                    $window.location.href = '/booth/' + scope.csrf.eventId + '/vote/' + hash + '/' + msg;
                                });
                        }
                    } else
                    {
                        // TODO: show error
                        redirectToLogin();
                        return;
                    }
                  },
                  function onError(response)
                  {
                    // TODO: show error
                    redirectToLogin();
                    return;
                  }
                );
        }

        processOpenIdAuthCallback();
      }
      return {
        restrict: 'AE',
        scope: true,
        link: link,
        templateUrl: 'avRegistration/openid-connect-directive/openid-connect-directive.html'
      };
    });
