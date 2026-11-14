Feature: Anonymous access to public share links

  Scenario: An anonymous visitor can view a shared photo
    Given I am not signed in
    And a share exists for an uploaded photo
    When I open the public share page for that share
    Then the public share page shows the shared photo
    When an anonymous client calls the public share API for that share
    Then the response status is 200

  Scenario: An anonymous visitor can browse a shared album and close the lightbox
    Given I am not signed in
    And a share exists for an album containing an uploaded photo
    When I open the public share page for that share
    Then the public share page shows the share album header and grid
    When I open the first share album photo
    Then the public share lightbox is open
    When I press Escape
    Then the public share lightbox is closed

  Scenario: An unknown share token shows the not found page
    Given I am not signed in
    When I open "/share/does-not-exist"
    Then the public share page shows not found
    When an anonymous client calls "GET /api/share/does-not-exist"
    Then the response status is 404

  Scenario: A revoked share link stops working
    Given I am not signed in
    And a share exists for an uploaded photo
    When that share is revoked through the API
    When I open the public share page for that share
    Then the public share page shows not found

  Scenario: An anonymous visitor can play a shared video
    Given I am not signed in
    And a share exists for an uploaded video
    When I open the public share page for that share
    Then the public share page plays the shared video
