Feature: Backup admin APIs reject unauthorized callers

  Scenario Outline: Anonymous backup calls are rejected
    When an anonymous client calls "<call>"
    Then the response status is 401

    Examples:
      | call                                                                           |
      | POST /api/v1/admin/backups                                                     |
      | GET /api/v1/admin/backups/overview                                             |
      | GET /api/v1/admin/backups/status?emailOrId=00000000-0000-0000-0000-000000000000 |
      | GET /api/v1/admin/backups/progress?emailOrId=00000000-0000-0000-0000-000000000000 |

  Scenario Outline: Backup admin calls reject regular users
    Given I am signed in
    When I call "<call>" with my token
    Then the response status is 403

    Examples:
      | call                                                                           |
      | POST /api/v1/admin/backups                                                     |
      | GET /api/v1/admin/backups/overview                                             |
      | GET /api/v1/admin/backups/status?emailOrId=00000000-0000-0000-0000-000000000000 |
      | GET /api/v1/admin/backups/progress?emailOrId=00000000-0000-0000-0000-000000000000 |
