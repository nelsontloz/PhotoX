@fresh
Feature: First registered account becomes administrator

  Scenario: The first user on an empty instance registers as admin
    Given the instance database is empty
    When I register "admin@photox.test" through the register page
    Then I am signed in on the timeline
    And my session role is "admin"
    And the sidebar shows the admin link
    And the admin API accepts my session
    And I can open the admin dashboard
    And the users table lists "admin@photox.test"

  Scenario: The second registered account is a regular user
    When I sign out
    And I register "user@photox.test" through the register page
    Then my session role is "user"
    And the sidebar does not show the admin link
    And opening "/admin" redirects me to the timeline
