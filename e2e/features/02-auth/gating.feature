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

  Scenario Outline: Protected APIs reject requests without a token
    When an anonymous client calls "<call>"
    Then the response status is 401

    Examples:
      | call                                                                       |
      | GET /api/v1/assets                                                         |
      | GET /api/v1/albums                                                         |
      | POST /api/v1/albums                                                        |
      | GET /api/v1/shares                                                         |
      | DELETE /api/v1/shares/00000000-0000-0000-0000-000000000000                 |
      | GET /api/v1/persons                                                        |
      | GET /api/v1/admin/users                                                    |

  Scenario: The public file-stream route stays open (anonymous is not rejected)
    When an anonymous client calls "GET /api/v1/files/00000000-0000-0000-0000-000000000000/stream"
    Then the response status is 404

  Scenario: Public share routes are open and unknown tokens are not found
    When an anonymous client calls "GET /api/share/does-not-exist"
    Then the response status is 404

  Scenario: Admin-only APIs reject regular users
    Given I am signed in
    When I call "GET /api/v1/admin/users" with my token
    Then the response status is 403
