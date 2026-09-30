Feature: Anonymous visitors cannot reach the app

  Scenario Outline: Protected pages redirect to login
    Given I am not signed in
    When I open "<path>"
    Then I am on the login page

    Examples:
      | path       |
      | /          |
      | /albums    |
      | /favorites |
      | /trash     |
      | /people    |
      | /places    |
      | /shared    |
      | /admin     |

  Scenario: Protected APIs reject requests without a token
    When an anonymous client calls "GET /api/v1/assets"
    Then the response status is 401
    When an anonymous client calls "GET /api/v1/admin/users"
    Then the response status is 401

  Scenario: Admin-only APIs reject regular users
    Given I am signed in
    When I call "GET /api/v1/admin/users" with my token
    Then the response status is 403
